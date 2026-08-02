import { Pool, PoolClient } from "pg";
import { pool } from "../../../shared/db/pool";
import { Errors } from "../../../shared/utils/app-error";
import { descomponerPago } from "../../../shared/utils/pago-mixto";
import * as repo from "./caja.repository";
import {
  AbrirTurnoInput,
  AgregarMovimientoHistoricoInput,
  AnularVentaInput,
  CerrarTurnoInput,
  EditarMetodoPagoMovimientoInput,
  EditarMovimientoHistoricoInput,
  RegistrarEgresoInput,
  RegistrarIngresoInput,
} from "./caja.schema";

export async function obtenerTurnoAbierto() {
  return repo.findTurnoAbierto();
}

/**
 * Abre el turno del día con la base que el cajero declare (efectivo/banco).
 * El negocio trabaja día a día: no se hereda nada del cierre anterior. Solo
 * puede haber un turno abierto para todo el negocio a la vez.
 */
export async function abrirTurno(cajeroId: string, input: AbrirTurnoInput) {
  const turnoAbierto = await repo.findTurnoAbierto();
  if (turnoAbierto) {
    throw Errors.conflict("Ya hay un turno de caja abierto. Ciérralo antes de abrir uno nuevo.");
  }

  return repo.crearTurno(cajeroId, input.montoInicialEfectivo ?? 0, input.montoInicialBanco ?? 0);
}

export async function cerrarTurno(turnoId: string, input: CerrarTurnoInput) {
  const turno = await repo.getTurnoById(turnoId);
  if (!turno) throw Errors.notFound("Turno de caja no encontrado");
  if (turno.estado === "cerrado") throw Errors.conflict("Este turno ya está cerrado");

  const { ingresosEfectivo, egresosEfectivo, ingresosBanco, egresosBanco } =
    await repo.sumMovimientosPorTurno(turnoId);

  const montoFinalCalculadoEfectivo = Number(turno.montoInicialEfectivo) + ingresosEfectivo - egresosEfectivo;
  const montoFinalCalculadoBanco = Number(turno.montoInicialBanco) + ingresosBanco - egresosBanco;

  return repo.cerrarTurno(
    turnoId,
    input.montoFinalDeclaradoEfectivo,
    montoFinalCalculadoEfectivo,
    montoFinalCalculadoBanco,
  );
}

export async function obtenerResumenTurno(turnoId: string) {
  const turno = await repo.getTurnoById(turnoId);
  if (!turno) throw Errors.notFound("Turno de caja no encontrado");

  const suma = await repo.sumMovimientosPorTurno(turnoId);
  const saldoEfectivo = Number(turno.montoInicialEfectivo) + suma.ingresosEfectivo - suma.egresosEfectivo;
  const saldoBanco = Number(turno.montoInicialBanco) + suma.ingresosBanco - suma.egresosBanco;
  const movimientos = await repo.listMovimientosPorTurno(turnoId);
  const ingresosPorArea = await repo.sumIngresosPorModuloTurno(turnoId);

  return {
    turno,
    movimientos,
    saldos: {
      efectivo: saldoEfectivo,
      banco: saldoBanco,
      general: saldoEfectivo + saldoBanco,
    },
    ingresosPorArea,
    ...suma,
  };
}

async function turnoAbiertoOrThrow(executor: Pool | PoolClient) {
  const turno = await repo.findTurnoAbierto(executor);
  if (!turno) throw Errors.conflict("No hay un turno de caja abierto. Ábrelo antes de registrar movimientos.");
  return turno;
}

/**
 * Registra un ingreso en la caja abierta. Acepta un `executor` (PoolClient) opcional
 * para que otros módulos (ej. Migao al cerrar una orden) lo incluyan en su misma
 * transacción: si el cierre de la orden falla, el ingreso también se revierte.
 */
/** "mixto" se descompone en 1-2 movimientos ya con método puro (ver
 *  descomponerPago) — nunca se guarda "mixto" como tal en la base. */
export async function registrarIngreso(
  input: RegistrarIngresoInput,
  usuarioId: string,
  executor: Pool | PoolClient = pool,
) {
  const turno = await turnoAbiertoOrThrow(executor);
  const partes = descomponerPago(input);
  const descuentoPorcentaje = input.descuentoPorcentaje ?? 0;
  const movimientos = [];
  for (const parte of partes) {
    // Si hubo descuento, se guarda también cuánto habría sido esta línea sin
    // descontar (proporcional: el % se aplicó de forma uniforme sobre el
    // monto antes de repartir en efectivo/banco) — solo para mostrar el
    // detalle en el historial de Caja, la suma sigue siendo `parte.monto`.
    const montoSinDescuento = descuentoPorcentaje > 0 ? parte.monto / (1 - descuentoPorcentaje / 100) : undefined;
    movimientos.push(
      await repo.insertIngreso(executor, {
        turnoId: turno.id,
        moduloOrigenSlug: input.moduloOrigenSlug,
        monto: parte.monto,
        metodoPago: parte.metodoPago,
        motivo: input.motivo,
        referenciaEntidad: input.referenciaEntidad,
        referenciaId: input.referenciaId,
        usuarioId,
        montoSinDescuento,
        descuentoPorcentaje: descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
      }),
    );
  }
  return movimientos;
}

export async function registrarEgreso(input: RegistrarEgresoInput, usuarioId: string) {
  const turno = await turnoAbiertoOrThrow(pool);
  const partes = descomponerPago(input);
  const movimientos = [];
  for (const parte of partes) {
    movimientos.push(
      await repo.insertEgreso({
        turnoId: turno.id,
        categoriaGastoId: input.categoriaGastoId,
        monto: parte.monto,
        metodoPago: parte.metodoPago,
        motivo: input.motivo,
        usuarioId,
        proveedorId: input.proveedorId,
      }),
    );
  }
  return movimientos;
}

/**
 * Corrección exclusiva de Super Root: cambia el método de pago de un movimiento
 * (ej. una venta de Migao que el cajero cerró marcando "efectivo" cuando en
 * realidad fue "banco"). Solo se permite mientras el turno sigue abierto —
 * un turno cerrado ya tiene su conteo físico de efectivo hecho, y cambiar el
 * método de pago después desajustaría el `monto_final_calculado_efectivo` sin
 * que nadie vuelva a contar la caja.
 */
export async function editarMetodoPagoMovimiento(movimientoId: number, input: EditarMetodoPagoMovimientoInput) {
  const movimiento = await repo.getMovimientoById(movimientoId);
  if (!movimiento) throw Errors.notFound("Movimiento no encontrado");

  const turno = await repo.getTurnoById(movimiento.turnoId);
  if (!turno || turno.estado !== "abierto") {
    throw Errors.conflict("Solo se puede corregir el método de pago de movimientos del turno abierto");
  }

  // El área (modulo_origen_id) solo existe en los ingresos — los egresos se
  // clasifican por categoría de gasto, no por módulo (ver schema.sql).
  if (input.moduloOrigenSlug && movimiento.tipo !== "ingreso") {
    throw Errors.badRequest("Solo se puede corregir el área de un ingreso");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (input.metodoPago !== "mixto") {
      const actualizado = await repo.actualizarMetodoPagoMovimiento(
        client,
        movimientoId,
        input.metodoPago,
        input.moduloOrigenSlug,
      );
      if (movimiento.referenciaEntidad === "ventas" && movimiento.referenciaId) {
        await repo.actualizarMetodoPagoPagoPorVenta(client, movimiento.referenciaId, input.metodoPago);
      }
      await client.query("COMMIT");
      return [actualizado];
    }

    // Convertir a mixto: el monto original se reparte en 1-2 líneas ya puras,
    // sin cambiar cuánto se cobró en total (solo cómo se reparte el método).
    const montoOriginal = Number(movimiento.monto);
    if (Math.abs(input.montoEfectivo + input.montoBanco - montoOriginal) > 0.01) {
      throw Errors.badRequest(`La suma de efectivo + banco debe ser igual al monto original (${montoOriginal})`);
    }
    const partes = descomponerPago({
      metodoPago: "mixto",
      montoEfectivo: input.montoEfectivo,
      montoBanco: input.montoBanco,
    });

    if (movimiento.referenciaEntidad === "ventas" && movimiento.referenciaId) {
      // Solo se ofrece "Editar" en el frontend cuando la venta tiene exactamente
      // un pago (ver listOrdenesHistorial) — se revalida aquí antes de tocar nada.
      const pagosVenta = await repo.listPagosPorVenta(client, movimiento.referenciaId);
      if (pagosVenta.length !== 1) {
        throw Errors.conflict("No se puede dividir: esta venta ya no tiene exactamente un pago registrado");
      }
      const [pago] = pagosVenta;
      await repo.borrarPago(client, pago.id);
      for (const parte of partes) {
        await repo.crearPagoParaVenta(client, {
          ordenId: pago.ordenId,
          ventaId: movimiento.referenciaId,
          metodoPago: parte.metodoPago,
          monto: parte.monto,
          referencia: pago.referencia,
          usuarioId: pago.usuarioId,
        });
      }
    }

    await repo.borrarMovimiento(client, movimientoId);
    const nuevos = [];
    for (const parte of partes) {
      nuevos.push(
        await repo.duplicarMovimientoConOtroMetodo(
          client,
          movimiento,
          parte.metodoPago,
          parte.monto,
          input.moduloOrigenSlug,
        ),
      );
    }

    await client.query("COMMIT");
    return nuevos;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listarCategoriasGasto() {
  return repo.listCategoriasGasto();
}

export async function crearCategoriaGasto(nombre: string) {
  return repo.crearCategoriaGasto(nombre);
}

export async function actualizarCategoriaGasto(id: number, nombre: string) {
  return repo.actualizarCategoriaGasto(id, nombre);
}

export async function listarProveedores() {
  return repo.listProveedores();
}

export async function crearProveedor(nombre: string, contacto?: string, telefono?: string, email?: string) {
  return repo.crearProveedor(nombre, contacto, telefono, email);
}

export async function actualizarProveedor(
  id: string,
  nombre?: string,
  contacto?: string,
  telefono?: string,
  email?: string,
) {
  return repo.actualizarProveedor(id, nombre, contacto, telefono, email);
}

export async function desactivarProveedor(id: string) {
  return repo.desactivarProveedor(id);
}

/**
 * Reset exclusivo de Super Root: NO borra ningún turno ni movimiento previo (el
 * historial queda intacto para los reportes de Caja). Fuerza el cierre del
 * turno abierto sin pedir conteo físico (asume que el declarado coincide con
 * el calculado) y borra por completo sus egresos. El próximo turno arranca con
 * la base que el cajero declare al abrirlo, como cualquier otro día.
 */
export async function resetearCaja() {
  const turnoAbierto = await repo.findTurnoAbierto();
  if (!turnoAbierto) {
    throw Errors.conflict("No hay ningún turno abierto para reiniciar.");
  }

  // Los egresos del turno se borran ANTES de calcular el cierre, para que el
  // monto final calculado ya no los reste (dejaron de existir, no solo de contar).
  const egresosBorrados = await repo.borrarEgresosDelTurno(turnoAbierto.id);

  const { ingresosEfectivo, egresosEfectivo, ingresosBanco, egresosBanco } = await repo.sumMovimientosPorTurno(
    turnoAbierto.id,
  );
  const montoFinalCalculadoEfectivo = Number(turnoAbierto.montoInicialEfectivo) + ingresosEfectivo - egresosEfectivo;
  const montoFinalCalculadoBanco = Number(turnoAbierto.montoInicialBanco) + ingresosBanco - egresosBanco;
  const turnoCerrado = await repo.cerrarTurno(
    turnoAbierto.id,
    montoFinalCalculadoEfectivo,
    montoFinalCalculadoEfectivo,
    montoFinalCalculadoBanco,
  );

  return { turnoCerrado, egresosBorrados };
}

export async function obtenerTurnosPorFecha(fecha: string) {
  return repo.listTurnosPorFecha(fecha);
}

/** Detalle de movimientos de un día del historial — de qué es cada ingreso/
 *  egreso, no solo el total agregado. */
export async function obtenerMovimientosDelDia(fecha: string) {
  return repo.listMovimientosDelDia(fecha);
}

/** Borra permanentemente el historial de movimientos de un día — Super Root. */
export async function borrarHistorialDia(fecha: string) {
  const movimientosBorrados = await repo.borrarMovimientosDelDia(fecha);
  return { movimientosBorrados };
}

/** Borra permanentemente un turno completo (y sus movimientos) — Super Root.
 *  No se permite sobre el turno abierto: para ese caso ya existe "Reiniciar
 *  Caja", que además deja al negocio con un saldo consistente para seguir
 *  operando; borrar el turno abierto a secas dejaría la caja sin turno activo. */
export async function borrarTurno(turnoId: string) {
  const turno = await repo.getTurnoById(turnoId);
  if (!turno) throw Errors.notFound("Turno no encontrado");
  if (turno.estado === "abierto") {
    throw Errors.conflict('No se puede borrar el turno abierto — usa "Reiniciar Caja" para eso.');
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const movimientosBorrados = await repo.borrarMovimientosDeTurno(client, turnoId);
    await repo.borrarTurnoRow(client, turnoId);
    await client.query("COMMIT");
    return { movimientosBorrados };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function obtenerHistorialAnual(anio: number) {
  const dias = await repo.getHistorialDiario(anio);
  return dias.map((d) => ({
    fecha: d.fecha,
    ingresos: Number(d.ingresos),
    egresos: Number(d.egresos),
    neto: Number(d.ingresos) - Number(d.egresos),
    movimientos: Number(d.movimientos),
  }));
}

/** Recalcula monto_final_calculado_efectivo/banco y diferencia_efectivo de un
 *  turno YA cerrado tras un ajuste retroactivo — misma fórmula que el cierre
 *  normal, sin tocar estado/cerrado_en/declarado (ese sí fue un conteo físico
 *  real y no debe cambiar solo porque se corrigió un registro). */
async function recalcularCierreTurno(turnoId: string) {
  const turno = await repo.getTurnoById(turnoId);
  if (!turno) return;
  const { ingresosEfectivo, egresosEfectivo, ingresosBanco, egresosBanco } =
    await repo.sumMovimientosPorTurno(turnoId);
  const calculadoEfectivo = Number(turno.montoInicialEfectivo) + ingresosEfectivo - egresosEfectivo;
  const calculadoBanco = Number(turno.montoInicialBanco) + ingresosBanco - egresosBanco;
  const declarado =
    turno.montoFinalDeclaradoEfectivo !== null ? Number(turno.montoFinalDeclaradoEfectivo) : calculadoEfectivo;
  await repo.actualizarCierreCalculado(turnoId, calculadoEfectivo, calculadoBanco, declarado - calculadoEfectivo);
}

/**
 * Agrega un ingreso/egreso a un día YA cerrado (ej. se olvidó registrar un
 * gasto ese día). Exclusivo de Root/Super Root (general.caja.editar_movimiento).
 * Solo funciona si ese día calendario tiene exactamente un turno y ya está
 * cerrado — si no, no hay forma segura de saber a qué turno atribuirlo.
 */
export async function agregarMovimientoHistorico(
  fecha: string,
  input: AgregarMovimientoHistoricoInput,
  usuarioId: string,
) {
  const turno = await repo.getTurnoCerradoUnicoDelDia(fecha);
  if (!turno) {
    throw Errors.conflict(
      "Solo se puede ajustar un día con exactamente un turno, ya cerrado. Si es el turno de hoy, usa Registrar ingreso/egreso normal.",
    );
  }

  // Mediodía en hora Bogotá (offset fijo -05:00, Colombia no tiene horario de
  // verano): cae de sobra dentro del mismo día calendario en cualquier
  // consulta AT TIME ZONE 'America/Bogota' ya existente.
  const createdAt = new Date(`${fecha}T12:00:00-05:00`);

  const movimiento = await repo.insertMovimientoHistorico({
    turnoId: turno.id,
    tipo: input.tipo,
    moduloOrigenSlug: input.tipo === "ingreso" ? input.moduloOrigenSlug : undefined,
    categoriaGastoId: input.tipo === "egreso" ? input.categoriaGastoId : undefined,
    monto: input.monto,
    metodoPago: input.metodoPago,
    motivo: input.motivo,
    usuarioId,
    createdAt,
  });

  await repo.insertEdicionHistorial({
    movimientoId: movimiento.id,
    fecha,
    accion: "creado",
    datosAntes: null,
    datosDespues: movimiento,
    nota: input.nota,
    usuarioId,
  });

  await recalcularCierreTurno(turno.id);

  return movimiento;
}

/**
 * Corrige monto/método/motivo/módulo-o-categoría de un movimiento de un turno
 * YA cerrado. Los ingresos ligados a una venta de Migao (referencia_entidad
 * = 'ventas') no se pueden tocar aquí — se desincronizarían con `pagos`; para
 * esos ya existe "Corregir método de pago" (solo con turno abierto).
 */
export async function editarMovimientoHistorico(
  movimientoId: number,
  input: EditarMovimientoHistoricoInput,
  usuarioId: string,
) {
  const movimiento = await repo.getMovimientoById(movimientoId);
  if (!movimiento) throw Errors.notFound("Movimiento no encontrado");

  if (movimiento.tipo === "ingreso" && movimiento.referenciaEntidad) {
    throw Errors.conflict(
      "Este ingreso viene de una venta/orden — no se puede editar aquí. Usa la corrección de método de pago.",
    );
  }

  const turno = await repo.getTurnoById(movimiento.turnoId);
  if (!turno || turno.estado !== "cerrado") {
    throw Errors.conflict("Este ajuste es solo para movimientos de un turno ya cerrado.");
  }

  // Snapshot en snake_case (mismas llaves que `actualizado`, que viene crudo
  // de la fila de la base vía RETURNING *) para que el historial de cambios
  // pueda comparar antes/después con el mismo nombre de campo.
  const datosAntes = {
    id: movimiento.id,
    tipo: movimiento.tipo,
    monto: movimiento.monto,
    metodo_pago: movimiento.metodoPago,
    motivo: movimiento.motivo,
    modulo_origen_id: movimiento.moduloOrigenId,
    categoria_gasto_id: movimiento.categoriaGastoId,
  };
  const actualizado = await repo.actualizarMovimientoHistorico(movimientoId, {
    monto: input.monto,
    metodoPago: input.metodoPago,
    motivo: input.motivo,
    moduloOrigenSlug: movimiento.tipo === "ingreso" ? input.moduloOrigenSlug : undefined,
    categoriaGastoId: movimiento.tipo === "egreso" ? input.categoriaGastoId : undefined,
  });

  const fecha = new Date(actualizado.created_at).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  await repo.insertEdicionHistorial({
    movimientoId,
    fecha,
    accion: "editado",
    datosAntes,
    datosDespues: actualizado,
    nota: input.nota,
    usuarioId,
  });

  await recalcularCierreTurno(turno.id);

  return actualizado;
}

export async function listarEdicionesDelDia(fecha: string) {
  return repo.listEdicionesDelDia(fecha);
}

/**
 * Anula una venta (Migao o Con Sentido) desde cualquier día del historial de
 * Caja — Root o Super Root, ver general.caja.editar_movimiento. A diferencia
 * de editarMetodoPagoMovimiento (turno abierto) y editarMovimientoHistorico
 * (turno cerrado, nunca ventas), esta es la única vía para tocar un ingreso
 * ligado a una venta sin importar si el turno ya cerró.
 *
 * "Anular" nunca borra la venta de verdad (queda para auditoría, con
 * estado='anulada'): solo borra sus pagos/movimientos de Caja, así que deja
 * de sumar en los totales pero el registro de qué se vendió sigue existiendo.
 */
export async function anularVenta(movimientoId: number, input: AnularVentaInput, usuarioId: string) {
  const movimiento = await repo.getMovimientoById(movimientoId);
  if (!movimiento) throw Errors.notFound("Movimiento no encontrado");

  if (movimiento.tipo !== "ingreso" || !movimiento.referenciaEntidad || !movimiento.referenciaId) {
    throw Errors.conflict("Este movimiento no corresponde a una venta.");
  }
  if (!["ventas", "con_sentido_ventas"].includes(movimiento.referenciaEntidad)) {
    throw Errors.conflict("Este tipo de movimiento no se puede anular desde aquí.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Un pago "mixto" pudo dividirse en 2 líneas (efectivo + banco) con el
    // mismo referencia_id — hay que anularlas juntas, no solo la que se clickeó.
    const movimientos = await repo.listMovimientosPorReferencia(movimiento.referenciaEntidad, movimiento.referenciaId);
    if (movimientos.length === 0) throw Errors.notFound("Movimiento no encontrado");

    const ventaAnulada =
      movimiento.referenciaEntidad === "ventas"
        ? await repo.anularVentaGenerica(client, movimiento.referenciaId)
        : await repo.anularVentaConSentido(client, movimiento.referenciaId);
    if (!ventaAnulada) {
      throw Errors.conflict("Esta venta ya está anulada o ya no existe.");
    }

    if (movimiento.referenciaEntidad === "ventas") {
      const pagos = await repo.listPagosPorVenta(client, movimiento.referenciaId);
      for (const pago of pagos) {
        await repo.borrarPago(client, pago.id);
      }
    }

    // La auditoría se inserta ANTES de borrar: movimientos_caja_ediciones
    // exige que movimiento_id exista en movimientos_caja al momento del
    // INSERT (la FK se valida contra el estado actual de la transacción, no
    // contra el de antes) — insertarla después del DELETE la rechaza.
    for (const m of movimientos) {
      const fecha = new Date(m.created_at).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      await repo.insertEdicionHistorial(
        {
          movimientoId: m.id,
          fecha,
          accion: "anulado",
          datosAntes: m,
          datosDespues: {
            estado: "anulada",
            referencia_entidad: movimiento.referenciaEntidad,
            referencia_id: movimiento.referenciaId,
          },
          nota: input.nota,
          usuarioId,
        },
        client,
      );
    }

    await repo.borrarMovimientosPorReferencia(client, movimiento.referenciaEntidad, movimiento.referenciaId);

    await client.query("COMMIT");

    // Solo hace falta recalcular el cierre de turnos que ya estén cerrados
    // (uno abierto calcula sus saldos en vivo, sin nada guardado que arreglar).
    const turnoIds = [...new Set(movimientos.map((m) => m.turno_id as string))];
    for (const turnoId of turnoIds) {
      const turno = await repo.getTurnoById(turnoId);
      if (turno?.estado === "cerrado") await recalcularCierreTurno(turnoId);
    }

    return { venta: ventaAnulada, movimientosAnulados: movimientos.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
