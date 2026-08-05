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

export interface IngresoPorArea {
  slug: string;
  nombre: string;
  total: number;
}

/** Cuánto entró por cada área (módulo de origen) dentro de un turno — para la
 *  tabla de desglose al cerrar. LEFT JOIN desde `modulos` para que las áreas
 *  sin movimientos en ese turno igual aparezcan, en 0. */
export async function sumIngresosPorModuloTurno(turnoId: string): Promise<IngresoPorArea[]> {
  const result = await pool.query(
    `SELECT m.slug, m.nombre, COALESCE(SUM(mc.monto), 0) AS total
       FROM modulos m
       LEFT JOIN movimientos_caja mc
              ON mc.modulo_origen_id = m.id AND mc.turno_id = $1 AND mc.tipo = 'ingreso'
      GROUP BY m.id, m.slug, m.nombre
      ORDER BY m.nombre`,
    [turnoId],
  );
  return result.rows.map((row) => ({ slug: row.slug, nombre: row.nombre, total: Number(row.total) }));
}

export interface MovimientoCaja {
  id: number;
  turnoId: string;
  tipo: "ingreso" | "egreso";
  moduloOrigenId: number | null;
  categoriaGastoId: number | null;
  referenciaEntidad: string | null;
  referenciaId: string | null;
  monto: string;
  metodoPago: string;
  motivo: string | null;
  usuarioId: string;
}

export async function getMovimientoById(movimientoId: number): Promise<MovimientoCaja | null> {
  const result = await pool.query(
    `SELECT id, turno_id, tipo, modulo_origen_id, categoria_gasto_id, referencia_entidad, referencia_id,
            monto, metodo_pago, motivo, usuario_id
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
    moduloOrigenId: row.modulo_origen_id,
    categoriaGastoId: row.categoria_gasto_id,
    referenciaEntidad: row.referencia_entidad,
    referenciaId: row.referencia_id,
    monto: row.monto,
    metodoPago: row.metodo_pago,
    motivo: row.motivo,
    usuarioId: row.usuario_id,
  };
}

/** Corrige el método de pago de un movimiento ya registrado (ej. el cajero marcó
 *  "efectivo" en vez de "banco" al cobrar). Si el movimiento viene de una venta
 *  (orden de Migao cerrada), también corrige el `pagos.metodo_pago` asociado
 *  para que ambos registros sigan contando la misma historia. `moduloOrigenSlug`
 *  es opcional (COALESCE): corrige de qué área viene el ingreso, sin afectarlo
 *  si no se manda. */
export async function actualizarMetodoPagoMovimiento(
  client: PoolClient,
  movimientoId: number,
  metodoPago: string,
  moduloOrigenSlug?: string,
) {
  const result = await client.query(
    `UPDATE movimientos_caja
        SET metodo_pago = $2,
            modulo_origen_id = COALESCE((SELECT id FROM modulos WHERE slug = $3), modulo_origen_id)
      WHERE id = $1
      RETURNING *`,
    [movimientoId, metodoPago, moduloOrigenSlug ?? null],
  );
  return result.rows[0];
}

export async function actualizarMetodoPagoPagoPorVenta(client: PoolClient, ventaId: string, metodoPago: string) {
  await client.query(`UPDATE pagos SET metodo_pago = $2 WHERE venta_id = $1`, [ventaId, metodoPago]);
}

export async function borrarMovimiento(client: PoolClient, movimientoId: number) {
  await client.query(`DELETE FROM movimientos_caja WHERE id = $1`, [movimientoId]);
}

/**
 * Anular venta (Root/Super Root, cualquier día): un pago dividido en mixto
 * puede generar 2 filas en movimientos_caja con el mismo referencia_id, así
 * que estas funciones operan sobre TODAS las que compartan esa referencia,
 * no sobre un movimiento suelto.
 */
export async function listMovimientosPorReferencia(referenciaEntidad: string, referenciaId: string) {
  const result = await pool.query(
    `SELECT * FROM movimientos_caja WHERE referencia_entidad = $1 AND referencia_id = $2`,
    [referenciaEntidad, referenciaId],
  );
  return result.rows;
}

export async function borrarMovimientosPorReferencia(
  client: PoolClient,
  referenciaEntidad: string,
  referenciaId: string,
) {
  await client.query(`DELETE FROM movimientos_caja WHERE referencia_entidad = $1 AND referencia_id = $2`, [
    referenciaEntidad,
    referenciaId,
  ]);
}

/** Venta genérica (Migao y otros módulos que usan `ventas`/`pagos`) — ya
 *  tenía el estado 'anulada' en el schema, nunca se había usado. */
export async function anularVentaGenerica(client: PoolClient, ventaId: string) {
  const result = await client.query(
    `UPDATE ventas SET estado = 'anulada' WHERE id = $1 AND estado != 'anulada' RETURNING *`,
    [ventaId],
  );
  return result.rows[0] ?? null;
}

/** Venta de Con Sentido (con_sentido_ventas no usa `pagos`, el ingreso vive
 *  directo en movimientos_caja). */
export async function anularVentaConSentido(client: PoolClient, ventaId: string) {
  const result = await client.query(
    `UPDATE con_sentido_ventas SET estado = 'anulada' WHERE id = $1 AND estado != 'anulada' RETURNING *`,
    [ventaId],
  );
  return result.rows[0] ?? null;
}

/** Recrea un movimiento con los mismos datos del original pero método/monto
 *  distintos — usado al convertir un pago simple en "mixto" (una línea se
 *  actualiza in-place, la otra se inserta con esta función). Si se manda
 *  `moduloOrigenSlug`, reemplaza el área original (misma corrección que
 *  actualizarMetodoPagoMovimiento, pero acá es un INSERT nuevo, no un UPDATE). */
export async function duplicarMovimientoConOtroMetodo(
  client: PoolClient,
  original: MovimientoCaja,
  metodoPago: string,
  monto: number,
  moduloOrigenSlug?: string,
) {
  const result = await client.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, modulo_origen_id, categoria_gasto_id, referencia_entidad, referencia_id, monto, metodo_pago, motivo, usuario_id)
     VALUES ($1, $2, COALESCE((SELECT id FROM modulos WHERE slug = $11), $3), $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      original.turnoId,
      original.tipo,
      original.moduloOrigenId,
      original.categoriaGastoId,
      original.referenciaEntidad,
      original.referenciaId,
      monto,
      metodoPago,
      original.motivo,
      original.usuarioId,
      moduloOrigenSlug ?? null,
    ],
  );
  return result.rows[0];
}

export interface PagoVenta {
  id: string;
  ordenId: string | null;
  ventaId: string;
  metodoPago: string;
  monto: string;
  referencia: string | null;
  usuarioId: string;
}

export async function listPagosPorVenta(client: PoolClient, ventaId: string): Promise<PagoVenta[]> {
  const result = await client.query(
    `SELECT id, orden_id, venta_id, metodo_pago, monto, referencia, usuario_id FROM pagos WHERE venta_id = $1`,
    [ventaId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ordenId: row.orden_id,
    ventaId: row.venta_id,
    metodoPago: row.metodo_pago,
    monto: row.monto,
    referencia: row.referencia,
    usuarioId: row.usuario_id,
  }));
}

export async function borrarPago(client: PoolClient, pagoId: string) {
  await client.query(`DELETE FROM pagos WHERE id = $1`, [pagoId]);
}

export async function crearPagoParaVenta(
  client: PoolClient,
  params: {
    ordenId: string | null;
    ventaId: string;
    metodoPago: string;
    monto: number;
    referencia: string | null;
    usuarioId: string;
  },
) {
  await client.query(
    `INSERT INTO pagos (orden_id, venta_id, metodo_pago, monto, referencia, usuario_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.ordenId, params.ventaId, params.metodoPago, params.monto, params.referencia, params.usuarioId],
  );
}

/** Borra permanentemente los egresos del turno indicado (solo ese turno, no
 *  todo el historial). Se usa al reiniciar Caja: a diferencia del resto del
 *  reset (que nunca borra nada), Super Root pidió explícitamente que los
 *  egresos sí desaparezcan del todo, no solo que dejen de contar para el saldo. */
export async function borrarEgresosDelTurno(turnoId: string) {
  const result = await pool.query(`DELETE FROM movimientos_caja WHERE turno_id = $1 AND tipo = 'egreso'`, [turnoId]);
  return result.rowCount ?? 0;
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
    montoSinDescuento?: number;
    descuentoPorcentaje?: number;
  },
) {
  const result = await executor.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, modulo_origen_id, referencia_entidad, referencia_id, monto, metodo_pago, motivo, usuario_id,
        monto_sin_descuento, descuento_porcentaje)
     VALUES ($1, 'ingreso', (SELECT id FROM modulos WHERE slug = $2), $3, $4, $5, $6, $7, $8, $9, $10)
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
      params.montoSinDescuento ?? null,
      params.descuentoPorcentaje ?? null,
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
  proveedorId?: string;
}) {
  const result = await pool.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, categoria_gasto_id, monto, metodo_pago, motivo, usuario_id, proveedor_id)
     VALUES ($1, 'egreso', $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [params.turnoId, params.categoriaGastoId, params.monto, params.metodoPago, params.motivo, params.usuarioId, params.proveedorId || null],
  );
  return result.rows[0];
}

/** Egreso contra el ACUMULADO TOTAL histórico (no un turno ni un día) —
 *  vive aparte de movimientos_caja, nunca exige turno abierto. */
export async function insertEgresoAcumulado(params: {
  categoriaGastoId: number;
  proveedorId?: string;
  monto: number;
  metodoPago: string;
  motivo: string;
  usuarioId: string;
}) {
  const result = await pool.query(
    `INSERT INTO caja_egresos_acumulado (categoria_gasto_id, proveedor_id, monto, metodo_pago, motivo, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [params.categoriaGastoId, params.proveedorId || null, params.monto, params.metodoPago, params.motivo, params.usuarioId],
  );
  return result.rows[0];
}

/** Ingresos y egresos brutos de TODA la vida de movimientos_caja (sin
 *  filtrar por turno ni fecha, desde la primera venta/movimiento que exista)
 *  — la base del "acumulado total histórico"; el service resta encima el
 *  SUM de caja_egresos_acumulado por método para el neto. */
export async function getAcumuladoMovimientosCaja() {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND metodo_pago = 'efectivo'), 0) AS ingresos_efectivo,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND metodo_pago = 'efectivo'), 0) AS egresos_efectivo,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND metodo_pago = 'banco'), 0) AS ingresos_banco,
       COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND metodo_pago = 'banco'), 0) AS egresos_banco
     FROM movimientos_caja`,
  );
  return result.rows[0];
}

export async function listEgresosAcumulado() {
  const result = await pool.query(
    `SELECT e.id, e.monto, e.metodo_pago, e.motivo, e.created_at,
            cg.nombre AS categoria_nombre, p.nombre AS proveedor_nombre, u.nombre AS usuario_nombre
       FROM caja_egresos_acumulado e
       JOIN categorias_gasto cg ON cg.id = e.categoria_gasto_id
       LEFT JOIN proveedores p ON p.id = e.proveedor_id
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      ORDER BY e.created_at DESC
      LIMIT 500`,
  );
  return result.rows;
}

/** Alta retroactiva de un ingreso/egreso en un día ya cerrado — a diferencia
 *  de insertIngreso/insertEgreso, fija `created_at` explícito (mediodía Bogotá
 *  de ese día) en vez de `now()`, para que caiga en el día correcto en todas
 *  las consultas AT TIME ZONE ya existentes. */
export async function insertMovimientoHistorico(params: {
  turnoId: string;
  tipo: "ingreso" | "egreso";
  moduloOrigenSlug?: string;
  categoriaGastoId?: number;
  proveedorId?: string;
  monto: number;
  metodoPago: string;
  motivo?: string;
  usuarioId: string;
  createdAt: Date;
}) {
  const result = await pool.query(
    `INSERT INTO movimientos_caja
       (turno_id, tipo, modulo_origen_id, categoria_gasto_id, proveedor_id, monto, metodo_pago, motivo, usuario_id, created_at)
     VALUES ($1, $2, (SELECT id FROM modulos WHERE slug = $3), $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.turnoId,
      params.tipo,
      params.moduloOrigenSlug ?? null,
      params.categoriaGastoId ?? null,
      params.proveedorId ?? null,
      params.monto,
      params.metodoPago,
      params.motivo ?? null,
      params.usuarioId,
      params.createdAt,
    ],
  );
  return result.rows[0];
}

/** Corrige monto/método/motivo/módulo-o-categoría de un movimiento ya
 *  registrado (a diferencia de actualizarMetodoPagoMovimiento, que solo toca
 *  el método y exige turno abierto) — pensado para movimientos de un turno
 *  YA cerrado. COALESCE: solo cambia los campos que vienen definidos. */
export async function actualizarMovimientoHistorico(
  movimientoId: number,
  cambios: {
    monto?: number;
    metodoPago?: string;
    motivo?: string;
    moduloOrigenSlug?: string;
    categoriaGastoId?: number;
    proveedorId?: string;
  },
) {
  const result = await pool.query(
    `UPDATE movimientos_caja
        SET monto = COALESCE($2, monto),
            metodo_pago = COALESCE($3, metodo_pago),
            motivo = COALESCE($4, motivo),
            modulo_origen_id = COALESCE((SELECT id FROM modulos WHERE slug = $5), modulo_origen_id),
            categoria_gasto_id = COALESCE($6, categoria_gasto_id),
            proveedor_id = COALESCE($7, proveedor_id)
      WHERE id = $1
      RETURNING *`,
    [
      movimientoId,
      cambios.monto ?? null,
      cambios.metodoPago ?? null,
      cambios.motivo ?? null,
      cambios.moduloOrigenSlug ?? null,
      cambios.categoriaGastoId ?? null,
      cambios.proveedorId ?? null,
    ],
  );
  return result.rows[0];
}

export interface EdicionHistorialCaja {
  id: number;
  movimientoId: number | null;
  fecha: string;
  accion: "creado" | "editado" | "anulado";
  datosAntes: unknown;
  datosDespues: unknown;
  nota: string;
  usuarioId: string;
  usuarioNombre: string | null;
  createdAt: string;
}

export async function insertEdicionHistorial(
  params: {
    movimientoId: number;
    fecha: string;
    accion: "creado" | "editado" | "anulado";
    datosAntes: unknown;
    datosDespues: unknown;
    nota: string;
    usuarioId: string;
  },
  // Acepta un `client` de una transacción en curso — usar `pool` (una conexión
  // aparte) mientras esa transacción todavía tiene sin comitear un DELETE/UPDATE
  // sobre la fila referenciada (movimientos_caja.id) causa un deadlock: esta
  // conexión espera el lock de la fila, la otra espera a que esta termine para
  // poder hacer COMMIT (ver anularVenta en caja.service.ts, donde se descubrió).
  executor: Executor = pool,
) {
  await executor.query(
    `INSERT INTO movimientos_caja_ediciones
       (movimiento_id, fecha, accion, datos_antes, datos_despues, nota, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.movimientoId,
      params.fecha,
      params.accion,
      params.datosAntes === null ? null : JSON.stringify(params.datosAntes),
      JSON.stringify(params.datosDespues),
      params.nota,
      params.usuarioId,
    ],
  );
}

export async function listEdicionesDelDia(fecha: string): Promise<EdicionHistorialCaja[]> {
  const result = await pool.query(
    `SELECT e.*, u.nombre AS usuario_nombre
       FROM movimientos_caja_ediciones e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.fecha = $1
      ORDER BY e.created_at ASC`,
    [fecha],
  );
  return result.rows.map((row) => ({
    id: row.id,
    movimientoId: row.movimiento_id,
    fecha: row.fecha,
    accion: row.accion,
    datosAntes: row.datos_antes,
    datosDespues: row.datos_despues,
    nota: row.nota,
    usuarioId: row.usuario_id,
    usuarioNombre: row.usuario_nombre,
    createdAt: row.created_at,
  }));
}

/** Un renglón por día con movimientos en el año dado — base para el resumen
 *  día/semana/mes y la grilla tipo calendario del historial de Caja. Se agrupa
 *  por la fecha del movimiento, no por turno (un turno puede quedar abierto de
 *  un día para otro, pero cada movimiento ya tiene su propio timestamp real). */
/** Turnos que arrancaron ese día calendario (mismo criterio to_char que
 *  getHistorialDiario, para que "ese día" signifique lo mismo en toda Caja). */
export async function listTurnosPorFecha(fecha: string): Promise<TurnoCaja[]> {
  const result = await pool.query(
    `SELECT * FROM turnos_caja WHERE to_char(abierto_en AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') = $1 ORDER BY abierto_en ASC`,
    [fecha],
  );
  return result.rows.map(mapTurno);
}

/** El único turno cerrado que arrancó ese día calendario — o null si hay 0 o
 *  más de uno (ambos casos son ambiguos para saber a qué turno atribuir un
 *  ajuste retroactivo, así que el service los rechaza con un mensaje claro
 *  en vez de adivinar). */
export async function getTurnoCerradoUnicoDelDia(fecha: string): Promise<TurnoCaja | null> {
  const turnos = await listTurnosPorFecha(fecha);
  if (turnos.length !== 1 || turnos[0].estado !== "cerrado") return null;
  return turnos[0];
}

/** Recalcula el cierre de un turno YA cerrado (tras agregar/editar un
 *  movimiento retroactivo) sin tocar estado/cerrado_en/declarado — misma
 *  fórmula que el cierre normal (ver caja.service.ts::cerrarTurno). */
export async function actualizarCierreCalculado(
  turnoId: string,
  montoFinalCalculadoEfectivo: number,
  montoFinalCalculadoBanco: number,
  diferenciaEfectivo: number,
): Promise<TurnoCaja> {
  const result = await pool.query(
    `UPDATE turnos_caja
        SET monto_final_calculado_efectivo = $2,
            monto_final_calculado_banco = $3,
            diferencia_efectivo = $4
      WHERE id = $1
      RETURNING *`,
    [turnoId, montoFinalCalculadoEfectivo, montoFinalCalculadoBanco, diferenciaEfectivo],
  );
  return mapTurno(result.rows[0]);
}

/** Detalle completo (no solo la suma) de los movimientos de un día calendario
 *  — para que el historial muestre de qué es cada ingreso/egreso, no solo el
 *  total. Mismo criterio de fecha (to_char sobre created_at) que el resto del
 *  historial, y mismos JOINs que listMovimientosPorTurno para traer el origen
 *  legible (módulo o categoría de gasto). */
export async function listMovimientosDelDia(fecha: string) {
  const result = await pool.query(
    `SELECT mc.*, m.slug AS modulo_origen_slug, cg.nombre AS categoria_gasto_nombre
       FROM movimientos_caja mc
       LEFT JOIN modulos m ON m.id = mc.modulo_origen_id
       LEFT JOIN categorias_gasto cg ON cg.id = mc.categoria_gasto_id
      WHERE to_char(mc.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') = $1
      ORDER BY mc.created_at ASC`,
    [fecha],
  );
  return result.rows;
}

/** Borra permanentemente todos los movimientos (ingresos y egresos) de un día
 *  calendario. No toca turnos_caja: el turno en sí (con sus montos de apertura
 *  y cierre ya calculados) queda como registro, solo desaparece su detalle. */
export async function borrarMovimientosDelDia(fecha: string) {
  const result = await pool.query(
    `DELETE FROM movimientos_caja WHERE to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') = $1`,
    [fecha],
  );
  return result.rowCount ?? 0;
}

export async function borrarMovimientosDeTurno(client: PoolClient, turnoId: string) {
  const result = await client.query(`DELETE FROM movimientos_caja WHERE turno_id = $1`, [turnoId]);
  return result.rowCount ?? 0;
}

export async function borrarTurnoRow(client: PoolClient, turnoId: string) {
  await client.query(`DELETE FROM turnos_caja WHERE id = $1`, [turnoId]);
}

export async function getHistorialDiario(anio: number) {
  // to_char en vez de ::date: pg devuelve DATE como objeto Date (JS) parseado en
  // la zona horaria local del proceso, y al serializar a JSON puede desplazar el
  // día si el servidor no corre en UTC. Un texto "YYYY-MM-DD" es inequívoco.
  // AT TIME ZONE 'America/Bogota' explícito (no basta con la config de sesión
  // del pool): si Supabase usa el pooler en modo transacción, cada consulta
  // puede caer en una conexión física distinta y el "SET timezone" de sesión
  // no aplica de forma confiable — esta conversión es correcta sin importar
  // la sesión.
  const result = await pool.query(
    `SELECT to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
            COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos,
            COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) AS egresos,
            COUNT(*) AS movimientos
       FROM movimientos_caja
      WHERE EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Bogota') = $1
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

export async function actualizarCategoriaGasto(id: number, nombre: string) {
  const result = await pool.query(
    `UPDATE categorias_gasto SET nombre = $2 WHERE id = $1 RETURNING id, nombre, activo`,
    [id, nombre],
  );
  return result.rows[0];
}

export async function listProveedores() {
  const result = await pool.query(
    `SELECT id, nombre, contacto, telefono, email FROM proveedores WHERE activo = true ORDER BY nombre ASC`,
  );
  return result.rows;
}

export async function crearProveedor(nombre: string, contacto?: string, telefono?: string, email?: string) {
  const result = await pool.query(
    `INSERT INTO proveedores (nombre, contacto, telefono, email)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, contacto, telefono, email, activo`,
    [nombre, contacto || null, telefono || null, email || null],
  );
  return result.rows[0];
}

export async function actualizarProveedor(
  id: string,
  nombre?: string,
  contacto?: string,
  telefono?: string,
  email?: string,
) {
  const updates: string[] = [];
  const values: (string | undefined)[] = [];
  let paramCount = 1;

  if (nombre !== undefined) {
    updates.push(`nombre = $${paramCount++}`);
    values.push(nombre);
  }
  if (contacto !== undefined) {
    updates.push(`contacto = $${paramCount++}`);
    values.push(contacto);
  }
  if (telefono !== undefined) {
    updates.push(`telefono = $${paramCount++}`);
    values.push(telefono);
  }
  if (email !== undefined) {
    updates.push(`email = $${paramCount++}`);
    values.push(email);
  }

  if (updates.length === 0) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE proveedores SET ${updates.join(", ")}, updated_at = now() WHERE id = $${paramCount} RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function desactivarProveedor(id: string) {
  const result = await pool.query(
    `UPDATE proveedores SET activo = false, updated_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0];
}
