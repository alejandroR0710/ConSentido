import { Pool, PoolClient } from "pg";
import { pool } from "../../../shared/db/pool";
import { Errors } from "../../../shared/utils/app-error";
import { descomponerPago } from "../../../shared/utils/pago-mixto";
import * as repo from "./caja.repository";
import {
  AbrirTurnoInput,
  CerrarTurnoInput,
  EditarMetodoPagoMovimientoInput,
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
  const movimientos = [];
  for (const parte of partes) {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (input.metodoPago !== "mixto") {
      const actualizado = await repo.actualizarMetodoPagoMovimiento(client, movimientoId, input.metodoPago);
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
      nuevos.push(await repo.duplicarMovimientoConOtroMetodo(client, movimiento, parte.metodoPago, parte.monto));
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
