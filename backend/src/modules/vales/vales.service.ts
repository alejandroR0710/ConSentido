import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as cajaService from "../general/caja/caja.service";
import { getUsuarioById } from "../general/usuarios/usuarios.repository";
import * as repo from "./vales.repository";
import { CrearValeInput, ReponerValeInput } from "./vales.schema";

const ROLES_DUENO = new Set(["Root", "Super Root"]);
const CATEGORIA_GASTO_VALES = "Vales";

async function categoriaGastoValesId(): Promise<number> {
  const id = await repo.getCategoriaGastoPorNombre(CATEGORIA_GASTO_VALES);
  if (!id) throw Errors.conflict('No existe la categoría de gasto "Vales" — corre la migración del módulo de vales.');
  return id;
}

/** `monto`/`montoEfectivo`+`montoBanco` según el método — nunca los dos a la
 *  vez (mismo shape que descomponerPago espera). Solo se usa con el pago de
 *  un vale nuevo (CrearValeInput); la reposición construye su propio pago
 *  directo a partir de los montos ya guardados en el vale (ver abajo). */
function pagoDesdeInput(input: CrearValeInput) {
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
 * Crea el vale y, según `fuente`, genera de inmediato el egreso real que
 * corresponde — todo en una sola transacción: si el egreso falla (ej. no
 * hay turno abierto), el vale no se crea.
 */
export async function crearVale(input: CrearValeInput, usuarioId: string) {
  let duenoId: string | null = null;
  if (input.fuente === "dueno") {
    // input.duenoId ya viene garantizado por el refine del schema (Task 3).
    const dueno = await getUsuarioById(input.duenoId!);
    if (!dueno || !ROLES_DUENO.has(dueno.rol_nombre)) {
      throw Errors.badRequest("El dueño elegido no es una cuenta Root o Super Root válida");
    }
    duenoId = dueno.id;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const montoEfectivo = input.metodoPago === "mixto" ? input.montoEfectivo : input.metodoPago === "efectivo" ? input.monto : 0;
    const montoBanco = input.metodoPago === "mixto" ? input.montoBanco : input.metodoPago === "banco" ? input.monto : 0;

    const vale = await repo.crearVale(client, {
      pagadoA: input.pagadoA,
      destinatarioUsuarioId: input.destinatarioUsuarioId ?? null,
      destinatarioDocumento: input.destinatarioDocumento ?? null,
      concepto: input.concepto,
      montoEfectivo,
      montoBanco,
      fuente: input.fuente,
      duenoId,
      creadoPorId: usuarioId,
    });

    if (input.fuente === "turno") {
      await cajaService.registrarEgreso(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Vale ${vale.numero} — ${input.concepto}`,
          moduloOrigenSlug: "vales",
          referenciaEntidad: "vales",
          referenciaId: vale.id,
          ...pagoDesdeInput(input),
        },
        usuarioId,
        client,
      );
    } else if (input.fuente === "acumulado") {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Vale ${vale.numero} — ${input.concepto}`,
          referenciaEntidad: "vales",
          referenciaId: vale.id,
          ...pagoDesdeInput(input),
        },
        usuarioId,
        client,
      );
    }
    // fuente === "dueno": no se toca Caja.

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
          motivo: `Reposición vale ${vale.numero} — ${vale.pagado_a}`,
          moduloOrigenSlug: "vales",
          referenciaEntidad: "vales_reposicion",
          referenciaId: vale.id,
          ...pago,
        },
        usuarioId,
        client,
      );
    } else {
      await cajaService.registrarEgresoAcumulado(
        {
          categoriaGastoId: await categoriaGastoValesId(),
          motivo: `Reposición vale ${vale.numero} — ${vale.pagado_a}`,
          referenciaEntidad: "vales_reposicion",
          referenciaId: vale.id,
          ...pago,
        },
        usuarioId,
        client,
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

/** Anula un vale: revierte el/los egreso(s) reales que haya generado (al
 *  crearse y/o al reponerse), cada uno en la tabla que le corresponde según
 *  su fuente — turno usa `movimientos_caja`, acumulado usa
 *  `caja_egresos_acumulado`, son mecanismos de reversión distintos. */
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
