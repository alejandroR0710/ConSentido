import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { getUsuarioById } from "../general/usuarios/usuarios.repository";
import * as repo from "./vales.repository";
import { CobrarValeInput, CrearValeInput, PagoValeInput, ReponerValeInput } from "./vales.schema";

const ROLES_DUENO = new Set(["Root", "Super Root"]);
const CATEGORIA_GASTO_VALES = "Vales";
// `movimientos_caja.motivo` es TEXT, pero `caja_egresos_acumulado.motivo` es
// VARCHAR(200) (ver database/mysql/schema.sql) — como un vale puede ir a
// cualquiera de las dos según `fuente`, el motivo se recorta siempre al
// mismo límite para que no falle con un 500 opaco solo en el caso acumulado
// cuando el concepto (hasta 500 caracteres, ver vales.schema.ts) es largo.
const MOTIVO_MAX_LEN = 200;

function truncarMotivo(texto: string): string {
  return texto.slice(0, MOTIVO_MAX_LEN);
}

async function categoriaGastoValesId(): Promise<number> {
  const id = await repo.getCategoriaGastoPorNombre(CATEGORIA_GASTO_VALES);
  if (!id) throw Errors.conflict('No existe la categoría de gasto "Vales" — corre la migración del módulo de vales.');
  return id;
}

/** Un usuario eliminado (soft-delete) o desactivado no debe poder elegirse
 *  como dueño ni como destinatario vinculado — `getUsuarioById` no filtra
 *  esto (sigue encontrando la fila), así que hay que comprobarlo acá. El
 *  frontend ya los oculta de los selectores, pero esto es lo que de verdad
 *  lo impide si alguien llama la API directo. */
function usuarioActivo(u: { activo: boolean; deleted_at: string | null }): boolean {
  return u.activo && !u.deleted_at;
}

/** `monto`/`montoEfectivo`+`montoBanco` según el método — nunca los dos a la
 *  vez (mismo shape que descomponerPago espera). Solo se usa con el pago de
 *  un vale/préstamo (nunca con una deuda sin fuente, que no tiene esta forma). */
function pagoDesdeInput(input: PagoValeInput) {
  if (input.metodoPago === "mixto") {
    return { metodoPago: "mixto" as const, montoEfectivo: input.montoEfectivo, montoBanco: input.montoBanco };
  }
  return { metodoPago: input.metodoPago, monto: input.monto };
}

export async function listarVales(filtros: repo.FiltrosListarVales) {
  return repo.listVales(filtros);
}

export async function obtenerVale(id: string) {
  const vale = await repo.getValeById(id);
  if (!vale) throw Errors.notFound("Vale no encontrado");
  return vale;
}

/**
 * Crea el vale/deuda y, según el caso, genera de inmediato el egreso real
 * que corresponde — todo en una sola transacción: si el egreso falla (ej.
 * no hay turno abierto), nada se crea.
 *
 * - "fuente" en el input (pago normal, o deuda CON préstamo): mismo flujo de
 *   siempre, genera egreso según `fuente`.
 * - Sin "fuente" (solo válido para tipo="deuda"): no toca Caja en absoluto,
 *   solo guarda `montoAdeudado`.
 */
export async function crearVale(input: CrearValeInput, usuarioId: string) {
  let duenoId: string | null = null;
  if ("fuente" in input && input.fuente === "dueno") {
    // input.duenoId ya viene garantizado por el refine del schema (Task 2).
    const dueno = await getUsuarioById(input.duenoId!);
    if (!dueno || !ROLES_DUENO.has(dueno.rol_nombre) || !usuarioActivo(dueno)) {
      throw Errors.badRequest("El dueño elegido no es una cuenta Root o Super Root activa y válida");
    }
    duenoId = dueno.id;
  }

  if (input.destinatarioUsuarioId) {
    const destinatario = await getUsuarioById(input.destinatarioUsuarioId);
    if (!destinatario || !usuarioActivo(destinatario)) {
      throw Errors.badRequest("El usuario vinculado elegido no existe o ya no está activo");
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let montoEfectivo = 0;
    let montoBanco = 0;
    let montoAdeudado: number | null = null;
    if ("fuente" in input) {
      montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
      montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;
    } else {
      montoAdeudado = input.montoAdeudado;
    }

    const vale = await repo.crearVale(client, {
      tipo: input.tipo,
      pagadoA: input.pagadoA,
      destinatarioUsuarioId: input.destinatarioUsuarioId ?? null,
      destinatarioDocumento: input.destinatarioDocumento ?? null,
      concepto: input.concepto,
      montoEfectivo,
      montoBanco,
      montoAdeudado,
      fuente: "fuente" in input ? input.fuente : null,
      duenoId,
      creadoPorId: usuarioId,
    });

    if ("fuente" in input) {
      if (input.fuente === "turno") {
        await cajaService.registrarEgreso(
          {
            categoriaGastoId: await categoriaGastoValesId(),
            motivo: truncarMotivo(`Vale ${vale.numero} — ${input.concepto}`),
            moduloOrigenSlug: "vales",
            ...pagoDesdeInput(input),
          },
          usuarioId,
          client,
          { entidad: "vales", id: vale.id },
        );
      } else if (input.fuente === "acumulado") {
        await cajaService.registrarEgresoAcumulado(
          {
            categoriaGastoId: await categoriaGastoValesId(),
            motivo: truncarMotivo(`Vale ${vale.numero} — ${input.concepto}`),
            ...pagoDesdeInput(input),
          },
          usuarioId,
          client,
          { entidad: "vales", id: vale.id },
        );
      }
      // fuente === "dueno": no se toca Caja.
    }
    // Deuda sin préstamo (sin "fuente" en el input): no se toca Caja en absoluto.

    await client.query("COMMIT");
    return repo.getValeById(vale.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Marca un vale (fuente "dueno") como repuesto: genera el egreso real por
 *  el mismo monto/método del vale original, contra turno o acumulado a
 *  elegir en este momento. */
export async function marcarValeRepuesto(id: string, input: ReponerValeInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.fuente !== "dueno") throw Errors.conflict('Solo un vale con fuente "dueño" se puede marcar como repuesto');
    if (vale.repuesto_en) throw Errors.conflict("Este vale ya está repuesto");
    if (vale.anulado_en) throw Errors.conflict("Este vale está anulado");

    const montoEfectivo = Number(vale.monto_efectivo);
    const montoBanco = Number(vale.monto_banco);
    const pago =
      montoEfectivo > 0 && montoBanco > 0
        ? { metodoPago: "mixto" as const, montoEfectivo, montoBanco }
        : montoBanco > 0
          ? { metodoPago: "banco" as const, monto: montoBanco }
          : { metodoPago: "efectivo" as const, monto: montoEfectivo };

    if (input.fuenteReposicion === "turno") {
      await cajaService.registrarEgreso(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: truncarMotivo(`Reposición vale ${vale.numero} — ${vale.pagado_a}`),
          moduloOrigenSlug: "vales",
          ...pago,
        },
        usuarioId,
        client,
        { entidad: "vales_reposicion", id: vale.id },
      );
    } else {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: truncarMotivo(`Reposición vale ${vale.numero} — ${vale.pagado_a}`),
          ...pago,
        },
        usuarioId,
        client,
        { entidad: "vales_reposicion", id: vale.id },
      );
    }

    await repo.marcarRepuesto(client, id, input.fuenteReposicion);

    await client.query("COMMIT");
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cobra una deuda: el monto es siempre el exacto que se debe (no lo elige
 * quien cobra, solo el método de pago) — se valida server-side que lo que
 * llega coincide antes de generar el ingreso, nunca se confía en el total
 * que mande el formulario (mismo criterio aplicado a referenciaEntidad/
 * referenciaId tras la revisión del módulo original). Siempre contra el
 * turno abierto — no existe "ingreso acumulado" en este sistema.
 */
export async function cobrarVale(id: string, input: CobrarValeInput, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.tipo !== "deuda") throw Errors.conflict("Solo una deuda se puede marcar como cobrada");
    if (vale.cobrado_en) throw Errors.conflict("Esta deuda ya está cobrada");
    if (vale.anulado_en) throw Errors.conflict("Este vale está anulado");

    const montoAdeudadoTotal = vale.fuente
      ? Number(vale.monto_efectivo) + Number(vale.monto_banco)
      : Number(vale.monto_adeudado);
    const montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
    const montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;
    if (Math.abs(montoEfectivo + montoBanco - montoAdeudadoTotal) > 0.01) {
      throw Errors.badRequest(`El monto a cobrar debe ser exactamente lo que se debe (${montoAdeudadoTotal})`);
    }

    await cajaService.registrarIngreso(
      {
        moduloOrigenSlug: "vales",
        motivo: truncarMotivo(`Cobro de deuda — vale ${vale.numero} — ${vale.pagado_a}`),
        referenciaEntidad: "vales_cobro",
        referenciaId: id,
        ...input,
      },
      usuarioId,
      client,
    );

    await repo.marcarCobrado(client, id, montoEfectivo, montoBanco);

    await client.query("COMMIT");
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Anula un vale/deuda: revierte todos los movimientos reales que haya
 *  generado (préstamo o pago original, reposición al dueño, y cobro de la
 *  deuda), cada uno en la tabla que le corresponde según su fuente — turno
 *  usa `movimientos_caja`, acumulado usa `caja_egresos_acumulado`, son
 *  mecanismos de reversión distintos. Los tres son independientes entre sí. */
export async function anularVale(id: string, usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vale = await repo.getValeParaActualizar(client, id);
    if (!vale) throw Errors.notFound("Vale no encontrado");
    if (vale.anulado_en) throw Errors.conflict("Este vale ya está anulado");

    const nota = `Anulación de vale ${vale.numero}`;
    let turnoIdsAfectados: string[] = [];

    if (vale.fuente === "turno") {
      turnoIdsAfectados = await cajaService.anularMovimientosPorReferencia(client, "vales", id, nota, usuarioId);
    } else if (vale.fuente === "acumulado") {
      await cajaService.anularEgresoAcumuladoPorReferencia(client, "vales", id);
    }

    if (vale.repuesto_en) {
      if (vale.fuente_reposicion === "turno") {
        const ids = await cajaService.anularMovimientosPorReferencia(client, "vales_reposicion", id, nota, usuarioId);
        turnoIdsAfectados.push(...ids);
      } else if (vale.fuente_reposicion === "acumulado") {
        await cajaService.anularEgresoAcumuladoPorReferencia(client, "vales_reposicion", id);
      }
    }

    if (vale.cobrado_en) {
      // El cobro siempre fue contra el turno (nunca acumulado — ver
      // cobrarVale) — anularMovimientosPorReferencia ya es genérico sobre
      // movimientos_caja, sirve igual para un ingreso que para un egreso.
      const ids = await cajaService.anularMovimientosPorReferencia(client, "vales_cobro", id, nota, usuarioId);
      turnoIdsAfectados.push(...ids);
    }

    await repo.marcarAnulado(client, id);

    await client.query("COMMIT");
    if (turnoIdsAfectados.length) {
      await cajaService.recalcularCierresSiEstanCerrados([...new Set(turnoIdsAfectados)]);
    }
    return repo.getValeById(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
