import { pool } from "../../shared/db/pool";

export const MODULOS_ALCANCE_SLUGS = ["insumos", "con_sentido", "talleres", "general", "pedidos"] as const;

export const MODULOS_ALCANCE_SUBQUERY =
  "(SELECT id FROM modulos WHERE slug IN ('insumos','con_sentido','talleres','general','pedidos'))";

/**
 * Reporte "Resumen" — Bloques A (KPIs) y B (flujo por medio de pago) en una
 * sola consulta: ambos bloques leen del mismo universo de filas (todo el
 * alcance de negocio, ver MODULOS_ALCANCE_SUBQUERY), así que no hace falta
 * repetir el filtro en dos queries separadas. Mismo idioma que
 * `getTotalesMovimientos` de analytics.repository.ts (SUM(CASE...) directo
 * sobre movimientos_caja, sin COALESCE de respaldo con categorias_gasto),
 * con el filtro de alcance agregado — `modulo_origen_id IN (...)` excluye
 * (como un INNER JOIN) cualquier movimiento sin área asignada, igual que lo
 * hace la consulta manual de verificación del Paso 7 del brief.
 */
export async function getResumenTotales(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto END), 0) AS ingresos_total,
       COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto END), 0) AS gastos_total,
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND metodo_pago = 'efectivo' THEN monto END), 0) AS ingresos_efectivo,
       COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND metodo_pago = 'banco' THEN monto END), 0) AS ingresos_banco,
       COALESCE(SUM(CASE WHEN tipo = 'egreso' AND metodo_pago = 'efectivo' THEN monto END), 0) AS gastos_efectivo,
       COALESCE(SUM(CASE WHEN tipo = 'egreso' AND metodo_pago = 'banco' THEN monto END), 0) AS gastos_banco
     FROM movimientos_caja mc
     WHERE mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}
       AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  return result.rows[0];
}

/**
 * Bloque C: gastos por categoría. `LEFT JOIN` desde `categorias_gasto` (no al
 * revés, y nunca `WHERE EXISTS`/`INNER JOIN`) para que toda categoría activa
 * aparezca en la respuesta aunque no tenga ningún egreso en el rango — con
 * `total = 0` en vez de desaparecer de la lista (Review Focus del plan).
 */
export async function getGastosPorCategoria(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT cg.id, cg.nombre, COALESCE(SUM(mc.monto), 0) AS total
       FROM categorias_gasto cg
       LEFT JOIN movimientos_caja mc
         ON mc.categoria_gasto_id = cg.id
        AND mc.tipo = 'egreso'
        AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
      WHERE cg.activo = true
      GROUP BY cg.id, cg.nombre
      ORDER BY total DESC`,
    [desde, hasta],
  );
  return result.rows;
}

/**
 * Bloque D: ingresos por tipo — a propósito solo las 3 líneas de negocio del
 * Excel original (Insumos/Con Sentido/Talleres), NO las 5 del alcance de
 * negocio de arriba: `general`/`pedidos` son "cajón de sastre" (gastos fijos
 * sin área propia, respaldo de pedidos pre-migración), no líneas de negocio
 * con ventas propias que tenga sentido comparar aquí.
 */
export async function getIngresosPorTipo(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT m.slug, COALESCE(SUM(mc.monto), 0) AS total
       FROM modulos m
       LEFT JOIN movimientos_caja mc
         ON mc.modulo_origen_id = m.id
        AND mc.tipo = 'ingreso'
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
      WHERE m.slug IN ('insumos', 'con_sentido', 'talleres')
      GROUP BY m.slug`,
    [desde, hasta],
  );
  return result.rows;
}

/**
 * Bloque E: matriz de ventas por mes — a propósito SIN parámetros de fecha.
 * Spec: este bloque siempre muestra el histórico completo (todas las filas
 * mes/línea de negocio que existan), independiente del selector de período
 * del resto del Resumen — si se acotara al rango del request, con "mes
 * actual" por defecto la matriz colapsaría a una sola columna.
 */
export async function getVentasPorMes() {
  const result = await pool.query(
    `SELECT m.slug, DATE_FORMAT(mc.created_at, '%Y-%m') AS mes, COALESCE(SUM(mc.monto), 0) AS total
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
      WHERE mc.tipo = 'ingreso'
        AND m.slug IN ('insumos', 'con_sentido', 'talleres')
      GROUP BY m.slug, mes
      ORDER BY mes`,
  );
  return result.rows;
}
