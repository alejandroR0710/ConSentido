import { pool } from "../../../shared/db/pool";

/**
 * Todas las consultas filtran por DATE_FORMAT(columna, '%Y-%m-%d') (texto
 * "YYYY-MM-DD", inequívoco al serializar a JSON), igual que el resto de
 * "historial" de la app (ver caja.repository.ts). Las fechas ya se guardan
 * en hora de Bogotá (ver shared/db/pool.ts), así que no hace falta convertir.
 */

/**
 * Totales reales de ingresos/egresos del rango, sin pasar por la atribución
 * a un área — a diferencia de un ingreso (siempre trae `modulo_origen_id`,
 * es obligatorio al registrarlo), un egreso casi nunca tiene área propia: se
 * clasifica por categoría de gasto, y la mayoría de categorías (Servicios,
 * Mantenimiento, arriendo, etc.) no están ligadas a ningún módulo puntual
 * (ver caja.service.ts línea ~344 y categorias_gasto.modulo_id, nullable).
 * Si estos totales se calcularan sumando `getMovimientosPorModulo` (que
 * excluye moduloId=1 y descarta cualquier fila sin área vía el LEFT JOIN),
 * casi todos los egresos quedarían fuera y "Egresos totales" mostraría
 * siempre $0 aunque sí haya egresos reales — por eso este total se calcula
 * aparte, directo contra movimientos_caja completo.
 */
export async function getTotalesMovimientos(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos,
       COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto END), 0) AS egresos
     FROM movimientos_caja
     WHERE DATE_FORMAT(created_at, '%Y-%m-%d') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getMovimientosPorModulo(desde: string, hasta: string) {
  const result = await pool.query(
    `WITH mov AS (
       SELECT mc.tipo, mc.monto, mc.metodo_pago,
              -- El área de un egreso es la que fije el movimiento mismo, y si
              -- no trae una (la mayoría, hoy), la que tenga por defecto su
              -- categoría de gasto (ver categorias_gasto.modulo_id) — un
              -- ingreso siempre trae la suya propia, nunca hace falta el
              -- respaldo. Ver caja.repository.ts::insertEgreso/crearCategoriaGasto.
              COALESCE(mc.modulo_origen_id, cg.modulo_id) AS modulo_efectivo
         FROM movimientos_caja mc
         LEFT JOIN categorias_gasto cg ON cg.id = mc.categoria_gasto_id
        WHERE DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
     )
     SELECT
       m.id as modulo_id,
       m.nombre as modulo_nombre,
       COALESCE(SUM(CASE WHEN mov.tipo = 'ingreso' THEN mov.monto END), 0) AS ingresos,
       COALESCE(SUM(CASE WHEN mov.tipo = 'egreso' THEN mov.monto END), 0) AS egresos,
       COALESCE(SUM(CASE WHEN mov.tipo = 'ingreso' AND mov.metodo_pago = 'efectivo' THEN mov.monto END), 0) AS efectivo,
       COALESCE(SUM(CASE WHEN mov.tipo = 'ingreso' AND mov.metodo_pago = 'banco' THEN mov.monto END), 0) AS banco,
       COALESCE(SUM(CASE WHEN mov.tipo = 'egreso' AND mov.metodo_pago = 'efectivo' THEN mov.monto END), 0) AS egresos_efectivo,
       COALESCE(SUM(CASE WHEN mov.tipo = 'egreso' AND mov.metodo_pago = 'banco' THEN mov.monto END), 0) AS egresos_banco
     FROM modulos m
     LEFT JOIN mov ON mov.modulo_efectivo = m.id
     WHERE m.id != 1
     GROUP BY m.id, m.nombre
     ORDER BY ingresos DESC`,
    [desde, hasta],
  );
  return result.rows;
}

/**
 * Con Sentido NO usa las tablas genéricas `ventas`/`venta_items` (esas son
 * para Migao/Insumos, ligadas a un producto real del catálogo): sus ventas
 * viven en `con_sentido_ventas`/`con_sentido_venta_items`, con "producto" y
 * "categoria" como texto libre capturado al momento de vender (soporta
 * "+ Otro producto", no exige que exista en el catálogo) — ver
 * con_sentido.service.ts. Por eso necesita sus propias consultas en vez de
 * las genéricas de arriba con moduloId=4, que siempre daban cero.
 */
/** Efectivo/banco ya repartido de verdad (una venta "mixta" reparte su monto
 *  entre las dos bolsas, no cuenta completo en ninguna) — se lee de
 *  movimientos_caja, no de con_sentido_ventas.metodo_pago, por el mismo
 *  motivo que getIngresosPorMetodoPago de Migao más abajo: ahí ya no existe
 *  "mixto" (se descompuso en 1-2 líneas puras al registrar la venta), y de
 *  paso una venta anulada desaparece sola (anularVenta borra su movimiento). */
export async function getIngresosPorMetodoPagoConSentido(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN mc.metodo_pago = 'efectivo' THEN mc.monto END), 0) AS efectivo,
       COALESCE(SUM(CASE WHEN mc.metodo_pago = 'banco' THEN mc.monto END), 0) AS banco
     FROM movimientos_caja mc
     JOIN modulos m ON m.id = mc.modulo_origen_id
     WHERE m.slug = 'con_sentido' AND mc.tipo = 'ingreso'
       AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getIngresosConSentido(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto), 0) AS total
       FROM con_sentido_ventas
      WHERE DATE_FORMAT(created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        AND estado != 'anulada'`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getVentasPorCategoriaConSentido(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT COALESCE(cvi.categoria, 'Sin categoría') AS categoria,
            COUNT(*) AS cantidad, COALESCE(SUM(cvi.subtotal), 0) AS total
       FROM con_sentido_venta_items cvi
       JOIN con_sentido_ventas cv ON cv.id = cvi.venta_id
      WHERE DATE_FORMAT(cv.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        AND cv.estado != 'anulada'
      GROUP BY cvi.categoria
      ORDER BY total DESC`,
    [desde, hasta],
  );
  return result.rows;
}

export async function getProductosTopConSentido(desde: string, hasta: string, limit: number) {
  const result = await pool.query(
    `SELECT cvi.producto AS producto_nombre, COUNT(*) AS cantidad, COALESCE(SUM(cvi.subtotal), 0) AS total
       FROM con_sentido_venta_items cvi
       JOIN con_sentido_ventas cv ON cv.id = cvi.venta_id
      WHERE DATE_FORMAT(cv.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        AND cv.estado != 'anulada'
      GROUP BY cvi.producto
      ORDER BY cantidad DESC
      LIMIT $3`,
    [desde, hasta, limit],
  );
  return result.rows;
}

export async function getIngresosModulo(moduloId: number, desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT v.id) as cantidad,
       COALESCE(SUM(v.total), 0) as total
     FROM ventas v
     WHERE v.modulo_id = $1
       AND DATE_FORMAT(v.created_at, '%Y-%m-%d') BETWEEN $2 AND $3
       AND v.estado = 'completada'`,
    [moduloId, desde, hasta],
  );
  return result.rows[0];
}

export async function getVentasPorCategoria(moduloId: number, desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       cp.nombre as categoria,
       COUNT(vi.id) as cantidad,
       COALESCE(SUM(vi.subtotal), 0) as total
     FROM venta_items vi
     JOIN productos p ON p.id = vi.producto_id
     LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
     JOIN ventas v ON v.id = vi.venta_id
     WHERE p.modulo_id = $1
       AND DATE_FORMAT(v.created_at, '%Y-%m-%d') BETWEEN $2 AND $3
       AND v.estado = 'completada'
     GROUP BY cp.id, cp.nombre
     ORDER BY total DESC`,
    [moduloId, desde, hasta],
  );
  return result.rows;
}

export async function getProductosTopVendidos(moduloId: number, desde: string, hasta: string, limit: number) {
  const result = await pool.query(
    `SELECT
       p.nombre as producto_nombre,
       p.costo,
       p.precio,
       COUNT(vi.id) as cantidad,
       COALESCE(SUM(vi.subtotal), 0) as total
     FROM venta_items vi
     JOIN productos p ON p.id = vi.producto_id
     JOIN ventas v ON v.id = vi.venta_id
     WHERE p.modulo_id = $1
       AND DATE_FORMAT(v.created_at, '%Y-%m-%d') BETWEEN $2 AND $3
       AND v.estado = 'completada'
     GROUP BY p.id, p.nombre, p.costo, p.precio
     ORDER BY cantidad DESC
     LIMIT $4`,
    [moduloId, desde, hasta, limit],
  );
  return result.rows;
}

export async function getClientesFrecuentes(moduloId: number, desde: string, hasta: string, limit: number) {
  const result = await pool.query(
    `SELECT
       c.nombre as cliente_nombre,
       COUNT(DISTINCT v.id) as compras,
       COALESCE(SUM(v.total), 0) as total
     FROM ventas v
     JOIN clientes c ON c.id = v.cliente_id
     WHERE v.modulo_id = $1
       AND DATE_FORMAT(v.created_at, '%Y-%m-%d') BETWEEN $2 AND $3
       AND v.estado = 'completada'
     GROUP BY c.id, c.nombre
     ORDER BY compras DESC
     LIMIT $4`,
    [moduloId, desde, hasta, limit],
  );
  return result.rows;
}

export async function getCostosModulo(moduloId: number, desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(vi.cantidad * p.costo), 0) as total_costos
     FROM venta_items vi
     JOIN productos p ON p.id = vi.producto_id
     JOIN ventas v ON v.id = vi.venta_id
     WHERE p.modulo_id = $1
       AND DATE_FORMAT(v.created_at, '%Y-%m-%d') BETWEEN $2 AND $3
       AND v.estado = 'completada'`,
    [moduloId, desde, hasta],
  );
  return result.rows[0];
}

export async function getPedidosResumen(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total,
       COALESCE(SUM(p.precio_acordado), 0) as ingreso_total,
       COALESCE(SUM(p.costo_estimado), 0) as costo_total
     FROM pedidos p
     WHERE DATE_FORMAT(p.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
       AND p.estado != 'cancelado'`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getPedidosPorEstado(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       p.estado,
       COUNT(*) as cantidad,
       COALESCE(SUM(p.precio_acordado), 0) as ingreso_estimado
     FROM pedidos p
     WHERE DATE_FORMAT(p.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
     GROUP BY p.estado
     ORDER BY cantidad DESC`,
    [desde, hasta],
  );
  return result.rows;
}

export async function getGananciasPedidos(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(p.precio_acordado - p.costo_estimado), 0) as ganancia_total,
       CASE
         WHEN SUM(p.precio_acordado) = 0 THEN 0
         ELSE ROUND(100 * AVG((p.precio_acordado - p.costo_estimado) / NULLIF(p.precio_acordado, 0)))
       END as margen_promedio
     FROM pedidos p
     WHERE DATE_FORMAT(p.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
       AND p.estado != 'cancelado'`,
    [desde, hasta],
  );
  return result.rows[0];
}

/** Una cuenta pagada "administrativo" no generó ingreso real en Caja General
 *  (ver migao.service.ts::cerrarOrden) — tampoco debe contar en analíticas de
 *  pedidos/ganancias, aunque su `ordenes.estado` quede en 'cerrada' igual que
 *  cualquier otra. Mismo criterio que ya usa migao.repository.ts::listOrdenesHistorial. */
const SIN_PAGO_ADMINISTRATIVO = `NOT EXISTS (
  SELECT 1 FROM ventas v JOIN pagos p ON p.venta_id = v.id
   WHERE v.orden_id = o.id AND p.metodo_pago = 'administrativo'
)`;

export async function getResumenPedidos(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COUNT(CASE WHEN estado = 'cerrada' THEN 1 END) AS cerradas,
       COUNT(CASE WHEN estado = 'cancelada' THEN 1 END) AS canceladas,
       COALESCE(SUM(CASE WHEN estado = 'cerrada' THEN numero_personas END), 0) AS comensales,
       COUNT(DISTINCT CASE WHEN estado = 'cerrada' AND cliente_id IS NOT NULL THEN cliente_id END) AS clientes_unicos
     FROM ordenes o
     WHERE DATE_FORMAT(closed_at, '%Y-%m-%d') BETWEEN $1 AND $2
       AND (estado != 'cerrada' OR ${SIN_PAGO_ADMINISTRATIVO})`,
    [desde, hasta],
  );
  return result.rows[0];
}

/**
 * Costos y unidades vendidas — a nivel de ítem (orden_items), así que sigue el
 * criterio de "una orden con fan-out por ítem" que ya se usa en el resto de la
 * app: la exclusión de "administrativo" y el filtro de fecha se resuelven en
 * una CTE a nivel de ORDEN antes de unir con orden_items, para no repetir la
 * subconsulta EXISTS por cada fila de producto.
 */
export async function getGanancias(desde: string, hasta: string) {
  const result = await pool.query(
    `WITH ordenes_validas AS (
       SELECT o.id
         FROM ordenes o
        WHERE o.estado = 'cerrada'
          AND DATE_FORMAT(o.closed_at, '%Y-%m-%d') BETWEEN $1 AND $2
          AND ${SIN_PAGO_ADMINISTRATIVO}
     )
     SELECT
       COALESCE(SUM(oi.cantidad * p.costo), 0) AS costos,
       COALESCE(SUM(oi.cantidad), 0) AS items_vendidos
     FROM ordenes_validas ov
     JOIN orden_items oi ON oi.orden_id = ov.id AND oi.estado != 'cancelado'
     JOIN productos p ON p.id = oi.producto_id`,
    [desde, hasta],
  );
  return result.rows[0];
}

/**
 * Ingresos reales de Migao por método de pago, tomados directamente de
 * `movimientos_caja` (no de `orden_items`/`ventas`): así el monto ya viene con
 * el descuento aplicado (`monto` es siempre el valor neto, ver
 * caja.service.ts::registrarIngreso) y las cuentas "administrativo" quedan
 * excluidas automáticamente — nunca generan una fila ahí.
 */
export async function getIngresosPorMetodoPago(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN mc.metodo_pago = 'efectivo' THEN mc.monto END), 0) AS efectivo,
       COALESCE(SUM(CASE WHEN mc.metodo_pago = 'banco' THEN mc.monto END), 0) AS banco
     FROM movimientos_caja mc
     JOIN modulos m ON m.id = mc.modulo_origen_id
     WHERE m.slug = 'migao' AND mc.tipo = 'ingreso'
       AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

/** Resumen de cuentas pagadas "administrativo" en el rango — el detalle
 *  completo de cada una vive en su propio historial (ver
 *  migao.repository.ts::listOrdenesHistorialAdministrativo), esto es solo el
 *  total/conteo para mostrar en el Dashboard. */
export async function getResumenAdministrativo(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COUNT(*) AS cuentas,
       COALESCE(SUM(v.total), 0) AS total
     FROM ordenes o
     JOIN ventas v ON v.orden_id = o.id
     JOIN pagos p ON p.venta_id = v.id AND p.metodo_pago = 'administrativo'
     WHERE o.estado = 'cerrada'
       AND DATE_FORMAT(o.closed_at, '%Y-%m-%d') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getParametrosMeseros(desde: string, hasta: string) {
  const ventas = await pool.query(
    `WITH ordenes_totales AS (
       SELECT o.id, o.mesero_id, o.created_at, o.closed_at,
              COALESCE(SUM(CASE WHEN oi.estado != 'cancelado' THEN oi.cantidad * oi.precio_unitario END), 0) AS total
         FROM ordenes o
         LEFT JOIN orden_items oi ON oi.orden_id = o.id
        WHERE o.estado = 'cerrada' AND DATE_FORMAT(o.closed_at, '%Y-%m-%d') BETWEEN $1 AND $2
        GROUP BY o.id, o.mesero_id, o.created_at, o.closed_at
     )
     SELECT u.id AS mesero_id, u.nombre AS mesero_nombre,
            COUNT(*) AS ordenes,
            SUM(ot.total) AS total_vendido,
            AVG((TIMESTAMPDIFF(MICROSECOND, ot.created_at, ot.closed_at) / 1000000) / 60) AS tiempo_promedio_min
       FROM ordenes_totales ot
       JOIN usuarios u ON u.id = ot.mesero_id
      GROUP BY u.id, u.nombre
      ORDER BY total_vendido DESC`,
    [desde, hasta],
  );

  const canceladas = await pool.query(
    `SELECT o.mesero_id, COUNT(*) AS canceladas
       FROM ordenes o
      WHERE o.estado = 'cancelada' AND DATE_FORMAT(o.closed_at, '%Y-%m-%d') BETWEEN $1 AND $2
      GROUP BY o.mesero_id`,
    [desde, hasta],
  );
  const canceladasPorMesero = new Map(canceladas.rows.map((r) => [r.mesero_id, Number(r.canceladas)]));

  return ventas.rows.map((r) => ({
    ...r,
    canceladas: canceladasPorMesero.get(r.mesero_id) ?? 0,
  }));
}

/** Tiempo entre "empieza a preparar" y "queda listo" por ítem (ver
 *  orden_historial: item_preparando/item_listo). Solo hay datos desde que se
 *  agregó este registro — órdenes anteriores no aparecen aquí. */
export async function getParametrosCocina(desde: string, hasta: string) {
  const result = await pool.query(
    `WITH tiempos AS (
       SELECT h1.orden_item_id, h1.created_at AS inicio, MIN(h2.created_at) AS fin
         FROM orden_historial h1
         JOIN orden_historial h2
           ON h2.orden_item_id = h1.orden_item_id AND h2.accion = 'item_listo' AND h2.created_at > h1.created_at
        WHERE h1.accion = 'item_preparando'
          AND DATE_FORMAT(h1.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        GROUP BY h1.orden_item_id, h1.created_at
     )
     SELECT COUNT(*) AS items_preparados,
            AVG((TIMESTAMPDIFF(MICROSECOND, inicio, fin) / 1000000) / 60) AS tiempo_promedio_min
       FROM tiempos`,
    [desde, hasta],
  );
  return result.rows[0];
}

/** Tiempo estimado de entrega: desde que se agregó el producto al pedido hasta
 *  que el mesero lo marcó entregado (item_entregado en orden_historial). */
export async function getTiempoEntrega(desde: string, hasta: string) {
  const result = await pool.query(
    `WITH entregas AS (
       SELECT oi.created_at AS creado, h.created_at AS entregado
         FROM orden_historial h
         JOIN orden_items oi ON oi.id = h.orden_item_id
        WHERE h.accion = 'item_entregado'
          AND DATE_FORMAT(h.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
     )
     SELECT COUNT(*) AS items_entregados,
            AVG((TIMESTAMPDIFF(MICROSECOND, creado, entregado) / 1000000) / 60) AS tiempo_promedio_min
       FROM entregas`,
    [desde, hasta],
  );
  return result.rows[0];
}
