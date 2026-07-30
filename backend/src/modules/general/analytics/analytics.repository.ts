import { pool } from "../../../shared/db/pool";

/**
 * Todas las consultas filtran por to_char(columna AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')
 * en vez de ::date, igual que el resto de "historial" de la app (ver
 * caja.repository.ts) — evita que un servidor no-UTC desplace el día al
 * serializar a JSON. El "AT TIME ZONE" explícito (no basta con la config de
 * sesión del pool) es necesario porque si Supabase usa el connection pooler
 * en modo transacción, cada consulta puede caer en una conexión física
 * distinta y el "SET timezone" de sesión no aplica de forma confiable — esta
 * conversión es correcta sin importar la sesión.
 */
const BOGOTA = "AT TIME ZONE 'America/Bogota'";

export async function getMovimientosPorModulo(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       m.id as modulo_id,
       m.nombre as modulo_nombre,
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.tipo = 'ingreso'), 0) AS ingresos,
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.tipo = 'egreso'), 0) AS egresos,
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.tipo = 'ingreso' AND mc.metodo_pago = 'efectivo'), 0) AS efectivo,
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.tipo = 'ingreso' AND mc.metodo_pago = 'banco'), 0) AS banco
     FROM modulos m
     LEFT JOIN movimientos_caja mc ON m.id = mc.modulo_origen_id
       AND to_char(mc.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
     WHERE m.id != 1
     GROUP BY m.id, m.nombre
     ORDER BY ingresos DESC`,
    [desde, hasta],
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
       AND to_char(v.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $2 AND $3
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
       AND to_char(v.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $2 AND $3
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
       AND to_char(v.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $2 AND $3
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
       AND to_char(v.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $2 AND $3
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
       AND to_char(v.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $2 AND $3
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
     WHERE to_char(p.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
     WHERE to_char(p.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
     WHERE to_char(p.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
       COUNT(*) FILTER (WHERE estado = 'cerrada') AS cerradas,
       COUNT(*) FILTER (WHERE estado = 'cancelada') AS canceladas,
       COALESCE(SUM(numero_personas) FILTER (WHERE estado = 'cerrada'), 0) AS comensales,
       COUNT(DISTINCT cliente_id) FILTER (WHERE estado = 'cerrada' AND cliente_id IS NOT NULL) AS clientes_unicos
     FROM ordenes o
     WHERE to_char(closed_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
          AND to_char(o.closed_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.metodo_pago = 'efectivo'), 0) AS efectivo,
       COALESCE(SUM(mc.monto) FILTER (WHERE mc.metodo_pago = 'banco'), 0) AS banco
     FROM movimientos_caja mc
     JOIN modulos m ON m.id = mc.modulo_origen_id
     WHERE m.slug = 'migao' AND mc.tipo = 'ingreso'
       AND to_char(mc.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2`,
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
       AND to_char(o.closed_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getParametrosMeseros(desde: string, hasta: string) {
  const ventas = await pool.query(
    `WITH ordenes_totales AS (
       SELECT o.id, o.mesero_id, o.created_at, o.closed_at,
              COALESCE(SUM(oi.cantidad * oi.precio_unitario) FILTER (WHERE oi.estado != 'cancelado'), 0) AS total
         FROM ordenes o
         LEFT JOIN orden_items oi ON oi.orden_id = o.id
        WHERE o.estado = 'cerrada' AND to_char(o.closed_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
        GROUP BY o.id, o.mesero_id, o.created_at, o.closed_at
     )
     SELECT u.id AS mesero_id, u.nombre AS mesero_nombre,
            COUNT(*) AS ordenes,
            SUM(ot.total) AS total_vendido,
            AVG(EXTRACT(EPOCH FROM (ot.closed_at - ot.created_at)) / 60) AS tiempo_promedio_min
       FROM ordenes_totales ot
       JOIN usuarios u ON u.id = ot.mesero_id
      GROUP BY u.id, u.nombre
      ORDER BY total_vendido DESC`,
    [desde, hasta],
  );

  const canceladas = await pool.query(
    `SELECT o.mesero_id, COUNT(*) AS canceladas
       FROM ordenes o
      WHERE o.estado = 'cancelada' AND to_char(o.closed_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
          AND to_char(h1.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
        GROUP BY h1.orden_item_id, h1.created_at
     )
     SELECT COUNT(*) AS items_preparados,
            AVG(EXTRACT(EPOCH FROM (fin - inicio)) / 60) AS tiempo_promedio_min
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
          AND to_char(h.created_at ${BOGOTA}, 'YYYY-MM-DD') BETWEEN $1 AND $2
     )
     SELECT COUNT(*) AS items_entregados,
            AVG(EXTRACT(EPOCH FROM (entregado - creado)) / 60) AS tiempo_promedio_min
       FROM entregas`,
    [desde, hasta],
  );
  return result.rows[0];
}
