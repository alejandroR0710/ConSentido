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

/**
 * Reporte "Ventas", Paso 1 — una fila por producto vendido en el mostrador
 * (Con Sentido/Insumos/Talleres), leyendo `con_sentido_venta_items`.
 *
 * Consecutivo: la FK real hacia `con_sentido_ventas` en `facturas` es
 * `con_sentido_venta_id`, NO `venta_id` (esa apunta a la tabla `ventas` de
 * Migao) — confirmado en `CREATE TABLE facturas` de schema.sql, y es el
 * mismo join que ya usa `JOIN_FACTURA_POR_MOVIMIENTO` en caja.repository.ts.
 * `con_sentido.service.ts::registrarVenta` crea la factura en la misma
 * transacción que la venta, pero un carrito de tienda vinculado a una mesa
 * (`parte_id`) puede quedar `estado='completada'` sin factura todavía (se
 * genera on-demand en `obtenerFacturaVenta` al imprimir) — de ahí el
 * `LEFT JOIN` y el `NULL` explícito en vez de inventar un número.
 *
 * `filtros.cliente` no se usa: `con_sentido_ventas`/`con_sentido_venta_items`
 * no tienen ninguna columna de cliente (venta de mostrador, ver nota en
 * reportes.types.ts::VentasFiltros) — no hay nada real contra qué filtrar.
 *
 * También trae `cv.monto`, `cv.monto_efectivo`, `cv.monto_banco` — el total y
 * el reparto de la venta completa (no del item) — para que el servicio pueda
 * prorratear el `subtotal` de cada item cuando `metodo_pago = 'mixto'` (ver
 * fix de review en reportes.service.ts: la versión anterior leía los totales
 * de `movimientos_caja` con una query independiente que no recibía estos
 * mismos filtros, rompiendo la consistencia bajo `?producto=`/`?cliente=` y
 * duplicando el leak de la otra mitad de una venta mixta bajo `?metodo=`).
 */
export async function getVentasDetalle(
  desde: string,
  hasta: string,
  filtros: { metodo?: "efectivo" | "banco"; cliente?: string; producto?: string } = {},
) {
  const params: unknown[] = [desde, hasta];
  let condiciones = "";
  if (filtros.metodo) {
    params.push(filtros.metodo);
    condiciones += ` AND cv.metodo_pago = $${params.length}`;
  }
  if (filtros.producto) {
    params.push(`%${filtros.producto}%`);
    condiciones += ` AND cvi.producto LIKE $${params.length}`;
  }

  const result = await pool.query(
    `SELECT cv.id, cv.created_at, DATE_FORMAT(cv.created_at, '%Y-%m-%d') AS fecha,
            cvi.producto, cvi.cantidad, cvi.precio_unitario, cvi.subtotal,
            cv.metodo_pago, m.slug AS area, f.numero AS consecutivo,
            cv.monto, cv.monto_efectivo, cv.monto_banco
       FROM con_sentido_venta_items cvi
       JOIN con_sentido_ventas cv ON cv.id = cvi.venta_id
       LEFT JOIN modulos m ON m.id = cvi.modulo_origen_id
       LEFT JOIN facturas f ON f.con_sentido_venta_id = cv.id
      WHERE cv.estado = 'completada'
        AND DATE_FORMAT(cv.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        ${condiciones}
      ORDER BY cv.created_at ASC, cvi.id ASC`,
    params,
  );
  return result.rows;
}

/**
 * Reporte "Ventas", Paso 2 — ingresos del alcance de negocio que NO
 * corresponden a una línea de producto ya cubierta por el Paso 1 (abonos de
 * pedidos, ingresos manuales de Caja General dentro del alcance...).
 *
 * Exclusión: `con_sentido.service.ts::registrarVenta` (grep real de
 * `referencia_entidad` en ese archivo) registra el ingreso con
 * `referenciaEntidad: "con_sentido_ventas"` y `referenciaId: venta.id` — el
 * mismo valor usa `migao.service.ts` para el lado de tienda de un carrito
 * vinculado a una mesa. Se excluye exactamente esa combinación, acotada a
 * `estado = 'completada'` para que calce 1:1 con el universo que de verdad
 * cubre `getVentasDetalle`: un carrito de mesa con abonos mientras sigue
 * `'pendiente'` no debe desaparecer de ningún lado — como sus items todavía
 * no cuentan en el Paso 1, su ingreso tampoco se excluye acá (cae en este
 * Paso 2 en vez de perderse).
 */
export async function getIngresosSinDetalle(
  desde: string,
  hasta: string,
  filtros: { metodo?: "efectivo" | "banco" } = {},
) {
  const params: unknown[] = [desde, hasta];
  let condiciones = "";
  if (filtros.metodo) {
    params.push(filtros.metodo);
    condiciones += ` AND mc.metodo_pago = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT mc.id, mc.created_at, DATE_FORMAT(mc.created_at, '%Y-%m-%d') AS fecha,
            mc.motivo, mc.monto, mc.metodo_pago, m.slug AS area
       FROM movimientos_caja mc
       LEFT JOIN modulos m ON m.id = mc.modulo_origen_id
      WHERE mc.tipo = 'ingreso'
        AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        AND NOT (
          mc.referencia_entidad = 'con_sentido_ventas'
          AND mc.referencia_id IN (SELECT id FROM con_sentido_ventas WHERE estado = 'completada')
        )
        ${condiciones}
      ORDER BY mc.created_at ASC`,
    params,
  );
  return result.rows;
}
