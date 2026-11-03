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
 * Reporte "Ventas por tipo" — mismo idioma que `getIngresosPorTipo` (mismo
 * filtro de 3 líneas de negocio, a propósito distinto de las 5 slugs de
 * `MODULOS_ALCANCE_SUBQUERY` — ver nota de Bloque D arriba, aplica igual
 * aquí), pero agrupado por día en vez de total — el servicio pivotea estas
 * filas planas a filas por día con columnas insumos/con_sentido/talleres.
 */
export async function getVentasPorTipoDiario(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT DATE_FORMAT(mc.created_at, '%Y-%m-%d') AS fecha, m.slug, COALESCE(SUM(mc.monto), 0) AS total
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
      WHERE mc.tipo = 'ingreso'
        AND m.slug IN ('insumos', 'con_sentido', 'talleres')
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
      GROUP BY fecha, m.slug
      ORDER BY fecha`,
    [desde, hasta],
  );
  return result.rows;
}

/**
 * Reporte "Conciliación" — verificación cruzada día por día: compara el
 * total de ingresos por método de pago (efectivo/banco) contra el total por
 * línea de negocio (Insumos/Con Sentido/Talleres). Mismo filtro de 3 líneas
 * de negocio que `getVentasPorTipoDiario`/`getIngresosPorTipo` arriba (NO las
 * 5 slugs de `MODULOS_ALCANCE_SUBQUERY` — ver nota de Bloque D), porque esta
 * comparación solo tiene sentido entre las líneas con ventas propias.
 *
 * A propósito UNA sola consulta con las 5 sumas condicionales en el mismo
 * `SELECT`, en vez de dos queries separadas (una agrupando por método, otra
 * por línea): el filtro (`tipo='ingreso' AND m.slug IN (...) AND rango`) se
 * aplica una única vez, ANTES de las dos agregaciones condicionales, así que
 * ambos lados leen exactamente el mismo conjunto de filas — por construcción
 * no puede haber divergencia entre ellos por un filtro que se desincronice
 * entre dos consultas (el bug real que Task 4 ya tuvo que evitar). El
 * `JOIN modulos` (no `LEFT JOIN`) no duplica filas: `modulos.id` es PK, cada
 * `mc.modulo_origen_id` matchea a lo sumo una fila de `modulos`.
 *
 * Sin `COALESCE` en las 5 columnas (literal del brief): un día con al menos
 * una fila que matchea el filtro pero, por ejemplo, ningún ingreso en banco,
 * trae `por_metodo_banco = NULL` para esa fila — el service lo normaliza a
 * `0` al sumar los totales (mismo patrón que `getMovimientosDiarios`).
 */
export async function getConciliacionDiaria(desde: string, hasta: string) {
  const result = await pool.query(
    `SELECT DATE_FORMAT(mc.created_at, '%Y-%m-%d') AS fecha,
            SUM(CASE WHEN mc.metodo_pago = 'efectivo' THEN mc.monto END) AS por_metodo_efectivo,
            SUM(CASE WHEN mc.metodo_pago = 'banco' THEN mc.monto END) AS por_metodo_banco,
            SUM(CASE WHEN m.slug = 'insumos' THEN mc.monto END) AS insumos,
            SUM(CASE WHEN m.slug = 'con_sentido' THEN mc.monto END) AS con_sentido,
            SUM(CASE WHEN m.slug = 'talleres' THEN mc.monto END) AS talleres
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
      WHERE mc.tipo = 'ingreso'
        AND m.slug IN ('insumos', 'con_sentido', 'talleres')
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
      GROUP BY fecha
      ORDER BY fecha`,
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

/**
 * Reporte "Gastos", Paso 1 — detalle de egresos del alcance de negocio (las
 * 5 slugs de `MODULOS_ALCANCE_SUBQUERY`, NO las 3 líneas de `getIngresosPorTipo`
 * — Gastos es del negocio completo, no solo de las líneas de producto, igual
 * que Bloques A-C del Resumen).
 *
 * `cg` (`categorias_gasto`) usa `JOIN` (no `LEFT JOIN`): el `CHECK (tipo =
 * 'ingreso' OR categoria_gasto_id IS NOT NULL)` de `movimientos_caja`
 * (schema.sql) garantiza que todo egreso SIEMPRE tiene `categoria_gasto_id`
 * — a diferencia de `proveedor_id` (nullable, de ahí el `LEFT JOIN p`: un
 * egreso sin proveedor asociado, ej. un gasto de nómina, no debe desaparecer
 * de la tabla, solo mostrar `proveedor: null`).
 *
 * Explícito por diseño (ver Spec, Brecha #3): la respuesta NO trae
 * `cantidad`/`costo_unitario` — un egreso es un monto total con `motivo` en
 * texto libre, no existe un desglose por línea en el modelo actual. No se
 * inventa ese dato ni se devuelve como `null` — simplemente no está en el
 * `SELECT`.
 */
export async function getGastosDetalle(
  desde: string,
  hasta: string,
  filtros: { categoriaId?: number; proveedorId?: string; metodo?: "efectivo" | "banco" } = {},
) {
  const params: unknown[] = [desde, hasta];
  let condiciones = "";
  if (filtros.categoriaId) {
    params.push(filtros.categoriaId);
    condiciones += ` AND cg.id = $${params.length}`;
  }
  if (filtros.proveedorId) {
    params.push(filtros.proveedorId);
    condiciones += ` AND p.id = $${params.length}`;
  }
  if (filtros.metodo) {
    params.push(filtros.metodo);
    condiciones += ` AND mc.metodo_pago = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT mc.id, mc.created_at, DATE_FORMAT(mc.created_at, '%Y-%m-%d') AS fecha,
            p.nombre AS proveedor, cg.nombre AS categoria,
            mc.motivo, mc.monto, mc.metodo_pago
       FROM movimientos_caja mc
       LEFT JOIN proveedores p ON p.id = mc.proveedor_id
       JOIN categorias_gasto cg ON cg.id = mc.categoria_gasto_id
      WHERE mc.tipo = 'egreso'
        AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
        ${condiciones}
      ORDER BY mc.created_at ASC`,
    params,
  );
  return result.rows;
}

/**
 * Reporte "Gastos", Paso 2 — ranking top N proveedores por gasto total del
 * rango (mismo filtro base de alcance/tipo/rango que `getGastosDetalle`,
 * sin los 3 filtros opcionales — el ranking es sobre el universo completo,
 * no sobre la vista filtrada de la tabla de detalle).
 *
 * `JOIN proveedores` (no `LEFT JOIN`) excluye por construcción cualquier
 * egreso sin proveedor asociado — "solo proveedores no nulos" del brief,
 * sin necesitar un `WHERE p.id IS NOT NULL` aparte.
 */
export async function getTopProveedores(desde: string, hasta: string, limit = 10) {
  const result = await pool.query(
    `SELECT p.id, p.nombre, COALESCE(SUM(mc.monto), 0) AS total
       FROM movimientos_caja mc
       JOIN proveedores p ON p.id = mc.proveedor_id
      WHERE mc.tipo = 'egreso'
        AND mc.modulo_origen_id IN ${MODULOS_ALCANCE_SUBQUERY}
        AND DATE_FORMAT(mc.created_at, '%Y-%m-%d') BETWEEN $1 AND $2
      GROUP BY p.id, p.nombre
      ORDER BY total DESC
      LIMIT $3`,
    [desde, hasta, limit],
  );
  return result.rows;
}

/**
 * Reporte "Cierre de caja diario", Paso 1 — movimientos del mes agrupados
 * por día. A PROPÓSITO sin `JOIN modulos` ni `modulo_origen_id IN
 * ${MODULOS_ALCANCE_SUBQUERY}` (única excepción de alcance de todo el
 * módulo, ver reportes.types.ts): es la caja física real y única del POS,
 * Migao incluido — no una vista acotada al negocio Con Sentido.
 *
 * Sin `COALESCE` en las 4 columnas (literal del brief): un día con AL MENOS
 * un movimiento pero, por ejemplo, ningún ingreso en banco, trae
 * `venta_banco = NULL` para esa fila — el service lo normaliza a `0` al
 * armar el saldo corrido. Un día SIN ningún movimiento no genera fila
 * aquí (no hay nada que agrupar); el service sintetiza esos días en `0` al
 * iterar el calendario completo del mes (Paso 3).
 */
export async function getMovimientosDiarios(mes: string) {
  const result = await pool.query(
    `SELECT DATE_FORMAT(mc.created_at, '%Y-%m-%d') AS fecha,
            SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.metodo_pago = 'efectivo' THEN mc.monto END) AS venta_efectivo,
            SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.metodo_pago = 'banco' THEN mc.monto END) AS venta_banco,
            SUM(CASE WHEN mc.tipo = 'egreso' AND mc.metodo_pago = 'efectivo' THEN mc.monto END) AS gastos_efectivo,
            SUM(CASE WHEN mc.tipo = 'egreso' AND mc.metodo_pago = 'banco' THEN mc.monto END) AS gastos_banco
       FROM movimientos_caja mc
      WHERE DATE_FORMAT(mc.created_at, '%Y-%m') = $1
      GROUP BY fecha`,
    [mes],
  );
  return result.rows;
}

/**
 * Reporte "Cierre de caja diario", Paso 2a — semilla del saldo corrido: el
 * turno más reciente abierto ANTES del mes seleccionado. Si no existe
 * ninguno (`rows[0] === undefined`), el service devuelve `saldo_inicial:
 * null` — dato no disponible, nunca `0` (Review Focus).
 *
 * Fix de revisión final (Finding C1) — el filtro anterior,
 * `DATE_FORMAT(abierto_en, '%Y-%m') <= $1`, comparaba STRINGS de mes
 * (`'YYYY-MM'`), no fechas: eso incluye cualquier turno abierto DURANTE el
 * propio mes solicitado (ej. pedir `mes=2026-10` con turnos abiertos el 1 y
 * el 31 de octubre devolvía el del 31, el turno MÁS RECIENTE *de* octubre,
 * en vez de "el turno más reciente antes de que octubre empezara" — que es
 * lo que `ORDER BY abierto_en DESC LIMIT 1` necesita para que
 * `getFlujoEntreFechas` (ver abajo) cubra exactamente la ventana correcta.
 * `abierto_en < CONCAT($1, '-01')` es una comparación real `DATETIME <
 * DATETIME` contra el primer instante del mes pedido (`'2026-10-01'` se
 * interpreta como `'2026-10-01 00:00:00'`) — ya no cuela ningún turno
 * abierto dentro del propio mes solicitado, solo turnos estrictamente
 * anteriores a él.
 *
 * `abierto_en` se trae (además de los dos montos iniciales) porque el
 * service lo necesita como límite inferior de `getFlujoEntreFechas` — ver
 * fix de review abajo: por definición no existe OTRO turno que haya abierto
 * entre el `abierto_en` de este turno y el inicio del mes solicitado (si
 * existiera, ESE sería "el turno más reciente" y este query lo habría
 * devuelto a él en su lugar), así que no hay ningún reseteo de caja physical
 * que se nos pueda escapar en esa ventana.
 */
export async function getPrimerTurnoDelRango(mes: string) {
  const result = await pool.query(
    `SELECT monto_inicial_efectivo, monto_inicial_banco, abierto_en
       FROM turnos_caja
      WHERE abierto_en < CONCAT($1, '-01')
      ORDER BY abierto_en DESC
      LIMIT 1`,
    [mes],
  );
  return result.rows[0];
}

/**
 * Reporte "Cierre de caja diario", Paso 2c (fix de review, Finding 1) — el
 * `saldo_inicial` del mes NO es solo `monto_inicial_efectivo`/
 * `monto_inicial_banco` del turno semilla (Paso 2a): si el mes solicitado es
 * posterior al mes en que ese turno abrió (ej. turno de octubre, mes
 * solicitado noviembre), falta sumarle todo lo que pasó en la caja entre esa
 * apertura y el día 1 del mes pedido — de lo contrario `saldo_inicial`
 * ignoraría ese arrastre y mostraría el monto de apertura crudo del turno en
 * vez del saldo real con el que la caja entra al mes.
 *
 * Mismo agregado que `getMovimientosDiarios` (ingreso − egreso por método,
 * SIN filtro de módulo — misma excepción de alcance de todo este reporte),
 * pero como UN total (no agrupado por día) y con límites de fecha explícitos
 * (`desde` inclusive, `hastaExclusive` exclusive) en vez de
 * `DATE_FORMAT(...) = $1`: necesita poder empezar a mitad de un mes, en el
 * `abierto_en` exacto del turno, no en el día 1 de su propio mes (eso evita
 * el otro bug del algoritmo original: contar dos veces los movimientos del
 * propio mes de apertura anteriores a `abierto_en`).
 *
 * El service la llama con `desde = turno.abierto_en` y
 * `hastaExclusive = '<mes>-01'`. Para el propio mes del turno (`mes ===
 * mes_de_abierto_en`), esa ventana es vacía o casi vacía (nada puede haber
 * pasado en la caja ANTES de que el turno la abriera) — por eso este fix no
 * cambia nada para una consulta sobre el mes del turno, solo para meses
 * posteriores.
 */
export async function getFlujoEntreFechas(desde: Date | string, hastaExclusive: string) {
  const result = await pool.query(
    `SELECT
       SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.metodo_pago = 'efectivo' THEN mc.monto END) AS venta_efectivo,
       SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.metodo_pago = 'banco' THEN mc.monto END) AS venta_banco,
       SUM(CASE WHEN mc.tipo = 'egreso' AND mc.metodo_pago = 'efectivo' THEN mc.monto END) AS gastos_efectivo,
       SUM(CASE WHEN mc.tipo = 'egreso' AND mc.metodo_pago = 'banco' THEN mc.monto END) AS gastos_banco
       FROM movimientos_caja mc
      WHERE mc.created_at >= $1
        AND mc.created_at < $2`,
    [desde, hastaExclusive],
  );
  return result.rows[0];
}

/**
 * Reporte "Cierre de caja diario", Paso 2b — una fila por CADA turno abierto
 * dentro del mes (no agrupado): el service junta los nombres por fecha,
 * porque puede haber más de un turno (cambio de cajero) el mismo día
 * calendario.
 */
export async function getCajerosPorDia(mes: string) {
  const result = await pool.query(
    `SELECT DATE_FORMAT(tc.abierto_en, '%Y-%m-%d') AS fecha, u.nombre
       FROM turnos_caja tc
       JOIN usuarios u ON u.id = tc.cajero_id
      WHERE DATE_FORMAT(tc.abierto_en, '%Y-%m') = $1`,
    [mes],
  );
  return result.rows;
}

/**
 * Reporte "Préstamos" — independiente de todo lo demás del módulo: lee
 * `vales`, no `movimientos_caja`, así que no hay concepto de módulo/alcance
 * de negocio acá (un vale no está etiquetado por área). `anulado_en IS NOT
 * NULL` excluye por completo un vale anulado (nunca debe contarse ni como
 * pendiente ni como resuelto) — mismo criterio que usa `listVales` de
 * vales.repository.ts para su filtro `estado='anulado'`, solo que acá se
 * excluye directo en vez de ofrecerse como opción.
 *
 * `destinatarioUsuarioId` es el único filtro (Spec: selector de
 * destinatario, no de período — por eso no hay `desde`/`hasta` aquí).
 *
 * Trae también `fuente` (fix de review) — el service la necesita para decidir
 * dónde vive el monto real de una fila `tipo='deuda'`: `vales.schema.ts`
 * permite una deuda CON `fuente` (dinero que sí salió de caja, a cobrar
 * después — "deuda con préstamo inicial"), y en ese caso
 * `vales.service.ts::crearVale` deja `monto_adeudado` en `NULL` (el monto
 * real queda en `monto_efectivo`/`monto_banco`, igual que un `tipo='pago'`).
 * Mismo criterio que ya usa `vales.service.ts::cobrarVale` para esa misma
 * distinción.
 */
export async function getVales(destinatarioUsuarioId?: string) {
  const params: unknown[] = [];
  let condicion = "";
  if (destinatarioUsuarioId) {
    params.push(destinatarioUsuarioId);
    condicion = ` AND destinatario_usuario_id = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT id, numero, tipo, fuente, pagado_a, destinatario_usuario_id, concepto,
            monto_efectivo, monto_banco, monto_adeudado, cobrado_en,
            monto_cobrado_efectivo, monto_cobrado_banco, repuesto_en, created_at
       FROM vales
      WHERE anulado_en IS NULL
        ${condicion}
      ORDER BY created_at DESC`,
    params,
  );
  return result.rows;
}
