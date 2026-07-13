import { Pool, PoolClient } from "pg";
import { pool } from "../../../shared/db/pool";
import { Errors } from "../../../shared/utils/app-error";
import * as repo from "./caja.repository";
import {
  AbrirTurnoInput,
  CerrarTurnoInput,
  RegistrarEgresoInput,
  RegistrarIngresoInput,
} from "./caja.schema";

export async function obtenerTurnoAbierto() {
  return repo.findTurnoAbierto();
}

/**
 * Vista previa de con cuánto va a abrir el próximo turno, para mostrarla ANTES
 * de que el cajero confirme "Abrir turno" (si no, tiene que adivinar o abrir a
 * ciegas para enterarse). Misma cuenta que hace `abrirTurno`, pero de solo
 * lectura — no crea nada.
 */
export async function obtenerProyeccionApertura() {
  const ultimoCerrado = await repo.findUltimoTurnoCerrado();
  return {
    hayCierreAnterior: ultimoCerrado !== null,
    montoInicialEfectivo: ultimoCerrado ? Number(ultimoCerrado.montoFinalDeclaradoEfectivo) : 0,
    montoInicialBanco: ultimoCerrado ? Number(ultimoCerrado.montoFinalCalculadoBanco) : 0,
  };
}

/**
 * Abre el turno del día. El ingreso es diario: los montos iniciales (efectivo y
 * banco) se heredan automáticamente del cierre del turno anterior, sin importar
 * qué cajero lo abrió. Solo puede haber un turno abierto para todo el negocio.
 */
export async function abrirTurno(cajeroId: string, input: AbrirTurnoInput) {
  const turnoAbierto = await repo.findTurnoAbierto();
  if (turnoAbierto) {
    throw Errors.conflict("Ya hay un turno de caja abierto. Ciérralo antes de abrir uno nuevo.");
  }

  const ultimoCerrado = await repo.findUltimoTurnoCerrado();
  const montoInicialEfectivo = ultimoCerrado
    ? Number(ultimoCerrado.montoFinalDeclaradoEfectivo)
    : (input.montoInicialEfectivo ?? 0);
  const montoInicialBanco = ultimoCerrado
    ? Number(ultimoCerrado.montoFinalCalculadoBanco)
    : (input.montoInicialBanco ?? 0);

  return repo.crearTurno(cajeroId, montoInicialEfectivo, montoInicialBanco);
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

  return {
    turno,
    movimientos,
    saldos: {
      efectivo: saldoEfectivo,
      banco: saldoBanco,
      general: saldoEfectivo + saldoBanco,
    },
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
export async function registrarIngreso(
  input: RegistrarIngresoInput,
  usuarioId: string,
  executor: Pool | PoolClient = pool,
) {
  const turno = await turnoAbiertoOrThrow(executor);
  return repo.insertIngreso(executor, {
    turnoId: turno.id,
    moduloOrigenSlug: input.moduloOrigenSlug,
    monto: input.monto,
    metodoPago: input.metodoPago,
    motivo: input.motivo,
    referenciaEntidad: input.referenciaEntidad,
    referenciaId: input.referenciaId,
    usuarioId,
  });
}

export async function registrarEgreso(input: RegistrarEgresoInput, usuarioId: string) {
  const turno = await turnoAbiertoOrThrow(pool);
  return repo.insertEgreso({
    turnoId: turno.id,
    categoriaGastoId: input.categoriaGastoId,
    monto: input.monto,
    metodoPago: input.metodoPago,
    motivo: input.motivo,
    usuarioId,
  });
}

/**
 * Corrección exclusiva de Super Root: cambia el método de pago de un movimiento
 * (ej. una venta de Migao que el cajero cerró marcando "efectivo" cuando en
 * realidad fue "banco"). Solo se permite mientras el turno sigue abierto —
 * un turno cerrado ya tiene su conteo físico de efectivo hecho, y cambiar el
 * método de pago después desajustaría el `monto_final_calculado_efectivo` sin
 * que nadie vuelva a contar la caja.
 */
export async function editarMetodoPagoMovimiento(movimientoId: number, metodoPago: "efectivo" | "banco") {
  const movimiento = await repo.getMovimientoById(movimientoId);
  if (!movimiento) throw Errors.notFound("Movimiento no encontrado");

  const turno = await repo.getTurnoById(movimiento.turnoId);
  if (!turno || turno.estado !== "abierto") {
    throw Errors.conflict("Solo se puede corregir el método de pago de movimientos del turno abierto");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actualizado = await repo.actualizarMetodoPagoMovimiento(client, movimientoId, metodoPago);
    if (movimiento.referenciaEntidad === "ventas" && movimiento.referenciaId) {
      await repo.actualizarMetodoPagoPagoPorVenta(client, movimiento.referenciaId, metodoPago);
    }
    await client.query("COMMIT");
    return actualizado;
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
 * Reset exclusivo de Super Root: NO borra ningún turno ni movimiento (el
 * historial queda intacto para los reportes de Caja). Si hay un turno abierto,
 * lo cierra primero con los montos ya calculados (sin conteo físico manual,
 * asume que el declarado coincide con el calculado). Después inserta un
 * "turno cero" ya cerrado, que pasa a ser el último cierre — así el próximo
 * turno que abra un Cajero hereda 0/0 en vez del saldo anterior.
 */
export async function resetearCaja(usuarioId: string) {
  const turnoAbierto = await repo.findTurnoAbierto();
  let turnoCerrado = null;

  if (turnoAbierto) {
    const { ingresosEfectivo, egresosEfectivo, ingresosBanco, egresosBanco } = await repo.sumMovimientosPorTurno(
      turnoAbierto.id,
    );
    const montoFinalCalculadoEfectivo = Number(turnoAbierto.montoInicialEfectivo) + ingresosEfectivo - egresosEfectivo;
    const montoFinalCalculadoBanco = Number(turnoAbierto.montoInicialBanco) + ingresosBanco - egresosBanco;
    turnoCerrado = await repo.cerrarTurno(
      turnoAbierto.id,
      montoFinalCalculadoEfectivo,
      montoFinalCalculadoEfectivo,
      montoFinalCalculadoBanco,
    );
  }

  const marcador = await repo.crearTurnoCerradoEnCero(usuarioId);
  return { turnoCerrado, marcador };
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
