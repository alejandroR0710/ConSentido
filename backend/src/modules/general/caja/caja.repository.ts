import { Pool, PoolClient } from "pg";
import { pool } from "../../../shared/db/pool";

/** Permite que otros módulos (ej. Migao al cerrar una orden) registren el ingreso
 *  dentro de su misma transacción, en vez de una escritura separada e inconsistente. */
type Executor = Pool | PoolClient;

export interface TurnoCaja {
  id: string;
  cajeroId: string;
  montoInicialEfectivo: string;
  montoInicialBanco: string;
  montoFinalDeclaradoEfectivo: string | null;
  montoFinalCalculadoEfectivo: string | null;
  diferenciaEfectivo: string | null;
  montoFinalCalculadoBanco: string | null;
  estado: "abierto" | "cerrado";
  abiertoEn: string;
  cerradoEn: string | null;
}

function mapTurno(row: any): TurnoCaja {
  return {
    id: row.id,
    cajeroId: row.cajero_id,
    montoInicialEfectivo: row.monto_inicial_efectivo,
    montoInicialBanco: row.monto_inicial_banco,
    montoFinalDeclaradoEfectivo: row.monto_final_declarado_efectivo,
    montoFinalCalculadoEfectivo: row.monto_final_calculado_efectivo,
    diferenciaEfectivo: row.diferencia_efectivo,
    montoFinalCalculadoBanco: row.monto_final_calculado_banco,
    estado: row.estado,
    abiertoEn: row.abierto_en,
    cerradoEn: row.cerrado_en,
  };
}

/** Solo puede existir un turno abierto para todo el negocio a la vez. */
export async function findTurnoAbierto(executor: Executor = pool): Promise<TurnoCaja | null> {
  const result = await executor.query(`SELECT * FROM turnos_caja WHERE estado = 'abierto' LIMIT 1`);
  return result.rowCount ? mapTurno(result.rows[0]) : null;
}

/** El turno nuevo hereda sus montos iniciales de este cierre (efectivo declarado, banco calculado). */
export async function findUltimoTurnoCerrado(): Promise<TurnoCaja | null> {
  const result = await pool.query(
    `SELECT * FROM turnos_caja WHERE estado = 'cerrado' ORDER BY cerrado_en DESC LIMIT 1`,
  );
  return result.rowCount ? mapTurno(result.rows[0]) : null;
}

export async function getTurnoById(turnoId: string): Promise<TurnoCaja | null> {
  const result = await pool.query(`SELECT * FROM turnos_caja WHERE id = $1`, [turnoId]);
  return result.rowCount ? mapTurno(result.rows[0]) : null;
}

export async function crearTurno(
  cajeroId: string,
  montoInicialEfectivo: number,
  montoInicialBanco: number,
): Promise<TurnoCaja> {
  const result = await pool.query(
    `INSERT INTO turnos_caja (cajero_id, monto_inicial_efectivo, monto_inicial_banco)
     VALUES ($1, $2, $3) RETURNING *`,
    [cajeroId, montoInicialEfectivo, montoInicialBanco],
  );
  return mapTurno(result.rows[0]);
}

export async function cerrarTurno(
  turnoId: string,
  montoFinalDeclaradoEfectivo: number,
  montoFinalCalculadoEfectivo: number,
  montoFinalCalculadoBanco: number,
): Promise<TurnoCaja> {
  const diferenciaEfectivo = montoFinalDeclaradoEfectivo - montoFinalCalculadoEfectivo;
  const result = await pool.query(
    `UPDATE turnos_caja
        SET estado = 'cerrado',
            monto_final_declarado_efectivo = $2,
            monto_final_calculado_efectivo = $3,
            diferencia_efectivo = $4,
            monto_final_calculado_banco = $5,
            cerrado_en = now()
      WHERE id = $1
      RETURNING *`,
    [turnoId, montoFinalDeclaradoEfectivo, montoFinalCalculadoEfectivo, diferenciaEfectivo, montoFinalCalculadoBanco],
  );
  return mapTurno(result.rows[0]);
}

/**
 * Marcador de reset: un turno que nace y se cierra en el mismo instante con todo
 * en cero. No borra ningún turno/movimiento anterior (queda íntegro para el
 * historial) — simplemente se convierte en "el último cierre", así que el
 * próximo turno real que se abra hereda 0/0 en vez del saldo previo.
 */
export async function crearTurnoCerradoEnCero(usuarioId: string): Promise<TurnoCaja> {
  const result = await pool.query(
    `INSERT INTO turnos_caja
       (cajero_id, monto_inicial_efectivo, monto_inicial_banco,
        monto_final_declarado_efectivo, monto_final_calculado_efectivo,
        diferencia_efectivo, monto_final_calculado_banco, estado, cerrado_en)
     VALUES ($1, 0, 0, 0, 0, 0, 0, 'cerrado', now())
     RETURNING *`,
    [usuarioId],
  );
  return mapTurno(result.rows[0]);
}

export interface SumaPorMetodo {
  ingresosEfectivo: number;
  egresosEfectivo: number;
  ingresosBanco: number;
  egresosBanco: number;
}

export async function sumMovimientosPorTurno(turnoId: string): Promise<SumaPorMetodo> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND metodo_pago = 'efectivo'), 0) AS ingresos_efectivo,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'  AND metodo_pago = 'efectivo'), 0) AS egresos_efectivo,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND metodo_pago = 'banco'), 0)    AS ingresos_banco,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'  AND metodo_pago = 'banco'), 0)    AS egresos_banco
     FROM movimientos_caja
     WHERE turno_id = $1`,
    [turnoId],
  );
  const row = result.rows[0];
  return {
    ingresosEfectivo: Number(row.ingresos_efectivo),
    egresosEfectivo: Number(row.egresos_efectivo),
    ingresosBanco: Number(row.ingresos_banco),
    egresosBanco: Number(row.egresos_banco),
  };
}

export interface MovimientoCaja {
  id: number;
  turnoId: string;
  tipo: "ingreso" | "egreso";
  referenciaEntidad: string | null;
  referenciaId: string | null;
  metodoPago: string;
}

export async function getMovimientoById(movimientoId: number): Promise<MovimientoCaja | null> {
  const result = await pool.query(
    `SELECT id, turno_id, tipo, referencia_entidad, referencia_id, metodo_pago
       FROM movimientos_caja
      WHERE id = $1`,
    [movimientoId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    turnoId: row.turno_id,
    tipo: row.tipo,
    referenciaEntidad: row.referencia_entidad,
    referenciaId: row.referencia_id,
    metodoPago: row.metodo_pago,
  };
}

/** Corrige el método de pago de un movimiento ya registrado (ej. el cajero marcó
 *  "efectivo" en vez de "banco" al cobrar). Si el movimiento viene de una venta
 *  (orden de Migao cerrada), también corrige el `pagos.metodo_pago` asociado
 *  para que ambos registros sigan contando la misma historia. */
export async function actualizarMetodoPagoMovimiento(client: PoolClient, movimientoId: number, metodoPago: string) {
  const result = await client.query(
    `UPDATE movimientos_caja SET metodo_pago = $2 WHERE id = $1 RETURNING *`,
    [movimientoId, metodoPago],
  );
  return result.rows[0];
}

export async function actualizarMetodoPagoPagoPorVenta(client: PoolClient, ventaId: string, metodoPago: string) {
  await client.query(`UPDATE pagos SET metodo_pago = $2 WHERE venta_id = $1`, [ventaId, metodoPago]);
}

export async function listMovimientosPorTurno(turnoId: string) {
  const result = await pool.query(
    `SELECT mc.*, m.slug AS modulo_origen_slug, cg.nombre AS categoria_gasto_nombre
       FROM movimientos_caja mc
       LEFT JOIN modulos m ON m.id = mc.modulo_origen_id
       LEFT JOIN categorias_gasto cg ON cg.id = mc.categoria_gasto_id
      WHERE mc.turno_id = $1
      ORDER BY mc.created_at DESC`,
    [turnoId],
  );
  return result.rows;
}

export async function insertIngreso(
  executor: Executor,
  params: {
    turnoId: string;
    moduloOrigenSlug: string;
    monto: number;
    metodoPago: string;
    motivo?: string;
    referenciaEntidad?: string;
    referenciaId?: string;
    usuarioId: string;
  },
) {
  const result = await executor.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, modulo_origen_id, referencia_entidad, referencia_id, monto, metodo_pago, motivo, usuario_id)
     VALUES ($1, 'ingreso', (SELECT id FROM modulos WHERE slug = $2), $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.turnoId,
      params.moduloOrigenSlug,
      params.referenciaEntidad ?? null,
      params.referenciaId ?? null,
      params.monto,
      params.metodoPago,
      params.motivo ?? null,
      params.usuarioId,
    ],
  );
  return result.rows[0];
}

export async function insertEgreso(params: {
  turnoId: string;
  categoriaGastoId: number;
  monto: number;
  metodoPago: string;
  motivo: string;
  usuarioId: string;
}) {
  const result = await pool.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, categoria_gasto_id, monto, metodo_pago, motivo, usuario_id)
     VALUES ($1, 'egreso', $2, $3, $4, $5, $6)
     RETURNING *`,
    [params.turnoId, params.categoriaGastoId, params.monto, params.metodoPago, params.motivo, params.usuarioId],
  );
  return result.rows[0];
}

/** Un renglón por día con movimientos en el año dado — base para el resumen
 *  día/semana/mes y la grilla tipo calendario del historial de Caja. Se agrupa
 *  por la fecha del movimiento, no por turno (un turno puede quedar abierto de
 *  un día para otro, pero cada movimiento ya tiene su propio timestamp real). */
export async function getHistorialDiario(anio: number) {
  // to_char en vez de ::date: pg devuelve DATE como objeto Date (JS) parseado en
  // la zona horaria local del proceso, y al serializar a JSON puede desplazar el
  // día si el servidor no corre en UTC. Un texto "YYYY-MM-DD" es inequívoco.
  const result = await pool.query(
    `SELECT to_char(created_at, 'YYYY-MM-DD') AS fecha,
            COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos,
            COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) AS egresos,
            COUNT(*) AS movimientos
       FROM movimientos_caja
      WHERE EXTRACT(YEAR FROM created_at) = $1
      GROUP BY 1
      ORDER BY 1`,
    [anio],
  );
  return result.rows;
}

export async function listCategoriasGasto() {
  const result = await pool.query(
    `SELECT id, nombre, activo FROM categorias_gasto WHERE activo = true ORDER BY nombre ASC`,
  );
  return result.rows;
}

export async function crearCategoriaGasto(nombre: string) {
  const result = await pool.query(
    `INSERT INTO categorias_gasto (nombre) VALUES ($1) RETURNING id, nombre, activo`,
    [nombre],
  );
  return result.rows[0];
}
