import { pool } from "../../../shared/db/pool";

/**
 * Todas las consultas filtran por to_char(...,'YYYY-MM-DD') en vez de ::date,
 * igual que el resto de "historial" de la app (ver caja.repository.ts) — evita
 * que un servidor no-UTC desplace el día al serializar a JSON.
 */

export async function getResumenPedidos(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE estado = 'cerrada') AS cerradas,
       COUNT(*) FILTER (WHERE estado = 'cancelada') AS canceladas,
       COALESCE(SUM(numero_personas) FILTER (WHERE estado = 'cerrada'), 0) AS comensales,
       COUNT(DISTINCT cliente_id) FILTER (WHERE estado = 'cerrada' AND cliente_id IS NOT NULL) AS clientes_unicos
     FROM ordenes
     WHERE to_char(closed_at, 'YYYY-MM-DD') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

export async function getGanancias(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS ingresos,
       COALESCE(SUM(oi.cantidad * p.costo), 0) AS costos,
       COALESCE(SUM(oi.cantidad), 0) AS items_vendidos
     FROM orden_items oi
     JOIN ordenes o ON o.id = oi.orden_id
     JOIN productos p ON p.id = oi.producto_id
     WHERE o.estado = 'cerrada' AND oi.estado != 'cancelado'
       AND to_char(o.closed_at, 'YYYY-MM-DD') BETWEEN $1 AND $2`,
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
        WHERE o.estado = 'cerrada' AND to_char(o.closed_at, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
      WHERE o.estado = 'cancelada' AND to_char(o.closed_at, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
          AND to_char(h1.created_at, 'YYYY-MM-DD') BETWEEN $1 AND $2
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
          AND to_char(h.created_at, 'YYYY-MM-DD') BETWEEN $1 AND $2
     )
     SELECT COUNT(*) AS items_entregados,
            AVG(EXTRACT(EPOCH FROM (entregado - creado)) / 60) AS tiempo_promedio_min
       FROM entregas`,
    [desde, hasta],
  );
  return result.rows[0];
}
