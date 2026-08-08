import { Pool, PoolClient } from "pg";
import { pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

export async function listMesas() {
  const result = await pool.query(
    `SELECT id, zona_id, numero, piso, capacidad, estado, pos_x, pos_y, ancho, alto, activo
       FROM mesas ORDER BY piso ASC, numero ASC`,
  );
  return result.rows;
}

/** Crea o reubica una mesa en el plano visual — mismo índice único que ya usa
 *  `getOrCreateMesaPorNumero` (numero+piso, sin zona), así que "dibujar" un
 *  número que un mesero ya creó a mano solo le agrega las coordenadas en vez
 *  de chocar con la restricción única. */
export async function crearMesaConLayout(params: {
  numero: string;
  piso: number;
  capacidad: number;
  posX: number;
  posY: number;
  ancho: number;
  alto: number;
}) {
  const result = await pool.query(
    `INSERT INTO mesas (numero, piso, capacidad, pos_x, pos_y, ancho, alto, activo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     ON CONFLICT (numero, piso) WHERE zona_id IS NULL
     DO UPDATE SET capacidad = EXCLUDED.capacidad, pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y,
                   ancho = EXCLUDED.ancho, alto = EXCLUDED.alto, activo = true
     RETURNING id, zona_id, numero, piso, capacidad, estado, pos_x, pos_y, ancho, alto, activo`,
    [params.numero, params.piso, params.capacidad, params.posX, params.posY, params.ancho, params.alto],
  );
  return result.rows[0];
}

export async function actualizarPosicionMesa(
  id: number,
  params: { posX: number; posY: number; ancho: number; alto: number },
) {
  const result = await pool.query(
    `UPDATE mesas SET pos_x = $2, pos_y = $3, ancho = $4, alto = $5 WHERE id = $1
     RETURNING id, zona_id, numero, piso, capacidad, estado, pos_x, pos_y, ancho, alto, activo`,
    [id, params.posX, params.posY, params.ancho, params.alto],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function actualizarDetalleMesa(
  id: number,
  params: { numero?: string; piso?: number; capacidad?: number; activo?: boolean },
) {
  const result = await pool.query(
    `UPDATE mesas
        SET numero = COALESCE($2, numero),
            piso = COALESCE($3, piso),
            capacidad = COALESCE($4, capacidad),
            activo = COALESCE($5, activo)
      WHERE id = $1
      RETURNING id, zona_id, numero, piso, capacidad, estado, pos_x, pos_y, ancho, alto, activo`,
    [id, params.numero ?? null, params.piso ?? null, params.capacidad ?? null, params.activo ?? null],
  );
  return result.rowCount ? result.rows[0] : null;
}

/** Borrado real — falla con FK (23503) si alguna orden (abierta o histórica)
 *  ya referencia esta mesa; el servicio traduce eso a "usa Desactivar". */
export async function eliminarMesa(id: number) {
  const result = await pool.query(`DELETE FROM mesas WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Get-or-create por número+piso: el mesero solo escribe el número (y opcionalmente
 *  ajusta el piso, por defecto 1), no hace falta configurar mesas antes. El mismo
 *  número puede repetirse en pisos distintos: son mesas físicas distintas. */
export async function getOrCreateMesaPorNumero(numero: string, piso = 1) {
  await pool.query(
    `INSERT INTO mesas (numero, piso) VALUES ($1, $2)
     ON CONFLICT (numero, piso) WHERE zona_id IS NULL DO NOTHING`,
    [numero, piso],
  );
  const result = await pool.query(
    `SELECT id, numero, piso FROM mesas WHERE numero = $1 AND piso = $2 AND zona_id IS NULL LIMIT 1`,
    [numero, piso],
  );
  return result.rows[0];
}

export async function listOrdenesAbiertas() {
  const result = await pool.query(
    `SELECT o.id, o.estado, o.created_at, o.comensal_numero, o.numero_personas, o.mesa_id,
            m.numero AS mesa_numero, m.piso AS mesa_piso, c.nombre AS cliente_nombre,
            u.nombre AS mesero_nombre,
            COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS total
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
       LEFT JOIN orden_items oi ON oi.orden_id = o.id AND oi.estado != 'cancelado'
      WHERE o.estado NOT IN ('cerrada', 'cancelada')
      GROUP BY o.id, o.estado, o.created_at, o.comensal_numero, o.numero_personas, o.mesa_id, m.numero, m.piso, c.nombre, u.nombre
      ORDER BY o.created_at ASC`,
  );
  return result.rows;
}

/** Registro de órdenes ya resueltas (cobradas o canceladas) para la pantalla de
 *  cobro del Cajero: separado de `listOrdenesAbiertas` a propósito, para que lo
 *  activo y lo ya cerrado no se mezclen en la misma tabla. Últimas 200 primero.
 *  Con `meseroId` se acota a las órdenes creadas por ese mesero (usado por
 *  "mi historial" en Mesero, en vez del historial completo que ve el Cajero). */
export async function listOrdenesHistorial(meseroId?: string) {
  const result = await pool.query(
    `SELECT o.id, o.estado, o.created_at, o.closed_at, o.comensal_numero, o.numero_personas,
            m.numero AS mesa_numero, m.piso AS mesa_piso, c.nombre AS cliente_nombre,
            u.nombre AS mesero_nombre, MAX(mc.movimiento_id) AS movimiento_id, MAX(mc.metodo_pago) AS metodo_pago,
            COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS total,
            MAX(v.descuento_porcentaje) AS descuento_porcentaje, MAX(v.total) AS total_cobrado,
            MAX(f.numero) AS numero_factura
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
       LEFT JOIN orden_items oi ON oi.orden_id = o.id AND oi.estado != 'cancelado'
       LEFT JOIN ventas v ON v.orden_id = o.id
       LEFT JOIN facturas f ON f.venta_id = v.id
       -- Subconsulta lateral (siempre da 0 o 1 fila por venta) en vez de un JOIN
       -- directo a movimientos_caja: una cuenta dividida genera varios pagos
       -- para la misma venta, y un JOIN directo multiplicaría las filas de
       -- orden_items en el SUM de arriba, inflando el total. Con 1 solo pago
       -- se puede editar el método (por eso movimiento_id); con más de uno se
       -- muestran combinados (ej. "efectivo+banco") pero no son editables ahí.
       LEFT JOIN LATERAL (
         SELECT
           CASE WHEN COUNT(*) = 1 THEN MAX(inner_mc.id) END AS movimiento_id,
           CASE
             WHEN COUNT(*) = 1 THEN MAX(inner_mc.metodo_pago)
             WHEN COUNT(*) > 1 THEN string_agg(DISTINCT inner_mc.metodo_pago, '+' ORDER BY inner_mc.metodo_pago)
           END AS metodo_pago
         FROM movimientos_caja inner_mc
         WHERE inner_mc.referencia_entidad = 'ventas' AND inner_mc.referencia_id = v.id::text
       ) mc ON true
      WHERE o.estado IN ('cerrada', 'cancelada')
        AND ($1::uuid IS NULL OR o.mesero_id = $1)
        -- Las cuentas cerradas con pago administrativo no cuentan como "pago
        -- diario": viven en su propio historial (ver listOrdenesHistorialAdministrativo).
        AND NOT EXISTS (
          SELECT 1 FROM pagos WHERE pagos.venta_id = v.id AND pagos.metodo_pago = 'administrativo'
        )
      GROUP BY o.id, o.estado, o.created_at, o.closed_at, o.comensal_numero, o.numero_personas, m.numero, m.piso,
               c.nombre, u.nombre
      ORDER BY o.closed_at DESC
      LIMIT 200`,
    [meseroId ?? null],
  );
  return result.rows;
}

/**
 * Historial separado de cuentas cerradas con pago "administrativo": no
 * generan ingreso en Caja General, así que no tiene sentido mezclarlas con
 * `listOrdenesHistorial` (el pago diario real) — quedan aquí con su propia
 * sumatoria. Exclusivo de Root/Super Root (ver migao.routes.ts).
 */
export async function listOrdenesHistorialAdministrativo() {
  const result = await pool.query(
    `SELECT o.id, o.estado, o.created_at, o.closed_at, o.comensal_numero, o.numero_personas,
            m.numero AS mesa_numero, m.piso AS mesa_piso, u.nombre AS mesero_nombre,
            MAX(v.descuento_porcentaje) AS descuento_porcentaje, MAX(v.total) AS total_cobrado,
            MAX(p.referencia) AS referencia,
            COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS total,
            MAX(f.numero) AS numero_factura
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
       LEFT JOIN orden_items oi ON oi.orden_id = o.id AND oi.estado != 'cancelado'
       JOIN ventas v ON v.orden_id = o.id
       JOIN pagos p ON p.venta_id = v.id AND p.metodo_pago = 'administrativo'
       LEFT JOIN facturas f ON f.venta_id = v.id
      WHERE o.estado = 'cerrada'
      GROUP BY o.id, o.estado, o.created_at, o.closed_at, o.comensal_numero, o.numero_personas, m.numero, m.piso,
               u.nombre
      ORDER BY o.closed_at DESC
      LIMIT 200`,
  );
  return result.rows;
}

/**
 * Cuánto entró de Migao por día y método de pago, tomado directamente de
 * `movimientos_caja` (no de `ordenes`/`ventas`): así una cuenta dividida entre
 * efectivo y banco queda repartida correctamente en cada bolsa (el historial
 * de órdenes solo muestra un método "combinado" por fila, no sirve para
 * sumar). Excluye "administrativo" solo porque esas cuentas nunca generan
 * fila aquí. AT TIME ZONE explícito por el mismo motivo que el resto de
 * consultas por día de la app (ver analytics.repository.ts).
 */
export async function getResumenDiarioIngresos(limiteDias = 60) {
  const result = await pool.query(
    `SELECT to_char(mc.created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
            COALESCE(SUM(mc.monto) FILTER (WHERE mc.metodo_pago = 'efectivo'), 0) AS efectivo,
            COALESCE(SUM(mc.monto) FILTER (WHERE mc.metodo_pago = 'banco'), 0) AS banco
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
      WHERE m.slug = 'migao' AND mc.tipo = 'ingreso'
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $1`,
    [limiteDias],
  );
  return result.rows;
}

/**
 * Ingresos registrados a mano desde Caja con origen "Migao (POS)" (ej. una venta
 * que no pasó por el flujo normal de crear/cerrar una orden). Se excluyen los que
 * ya tienen `referencia_entidad = 'ventas'` porque esos SÍ vienen de una orden
 * cerrada normal y ya aparecen en `listOrdenesHistorial` — si no se excluyeran,
 * la misma venta se vería duplicada. Solo para el historial del Cajero, no tiene
 * sentido acotarlo por mesero (un ingreso manual no tiene mesero asociado).
 */
export async function listIngresosManualesMigao() {
  const result = await pool.query(
    `SELECT mc.id, mc.monto, mc.motivo, mc.metodo_pago, mc.created_at, u.nombre AS usuario_nombre
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
       LEFT JOIN usuarios u ON u.id = mc.usuario_id
      WHERE m.slug = 'migao' AND mc.tipo = 'ingreso'
        AND mc.referencia_entidad IS DISTINCT FROM 'ventas'
      ORDER BY mc.created_at DESC
      LIMIT 200`,
  );
  return result.rows;
}

export async function crearOrden(
  meseroId: string,
  mesaId: number,
  clienteId?: string,
  numeroPersonas?: number,
  executor: Executor = pool,
) {
  const result = await executor.query(
    `INSERT INTO ordenes (mesa_id, mesero_id, cliente_id, numero_personas) VALUES ($1, $2, $3, $4) RETURNING *`,
    [mesaId, meseroId, clienteId ?? null, numeroPersonas ?? null],
  );
  return result.rows[0];
}

/** `sin_stock`/`bajo_stock` se calculan en vivo contra la receta de cada
 *  producto (migao_producto_ingredientes) — nunca se guardan aparte, así
 *  nunca se pueden desincronizar del stock real. `sin_stock` = ya no
 *  alcanza para preparar ni 1 unidad más de algún ingrediente; `bajo_stock`
 *  = algún ingrediente ya cruzó su stock mínimo (mismo criterio que la
 *  página de Inventario), pero todavía alcanza para al menos 1 más. Un
 *  producto sin receta nunca sale marcado (no depende de inventario). */
export async function listProductosMigao() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.categoria_id, p.descripcion, p.es_para_llevar, cp.nombre AS categoria_nombre,
            EXISTS (
              SELECT 1 FROM migao_producto_ingredientes pi
                JOIN migao_inventario_productos ip ON ip.id = pi.inventario_producto_id
               WHERE pi.producto_id = p.id AND ip.stock_unidades < pi.cantidad_por_unidad
            ) AS sin_stock,
            EXISTS (
              SELECT 1 FROM migao_producto_ingredientes pi
                JOIN migao_inventario_productos ip ON ip.id = pi.inventario_producto_id
               WHERE pi.producto_id = p.id AND ip.stock_minimo_unidades IS NOT NULL
                 AND ip.stock_unidades <= ip.stock_minimo_unidades
            ) AS bajo_stock
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
      WHERE m.slug = 'migao' AND p.activo = true
      ORDER BY cp.nombre ASC NULLS LAST, p.nombre ASC`,
  );
  return result.rows;
}

/** Solo los productos marcados como cargo de "para llevar" — para el picker
 *  que usa el Cajero en cobro (ver agregarCargoParaLlevar). */
export async function listProductosParaLlevar() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.categoria_id, p.descripcion, p.es_para_llevar, cp.nombre AS categoria_nombre
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
      WHERE m.slug = 'migao' AND p.activo = true AND p.es_para_llevar = true
      ORDER BY p.nombre ASC`,
  );
  return result.rows;
}

export async function getProductoMigaoById(id: string) {
  const result = await pool.query(
    `SELECT id, nombre, precio, categoria_id, descripcion, es_para_llevar, activo FROM productos WHERE id = $1`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function crearProductoMigao(params: {
  nombre: string;
  precio: number;
  costo: number;
  unidadMedida: string;
  categoriaId?: number;
  descripcion?: string;
  esParaLlevar: boolean;
}) {
  const result = await pool.query(
    `INSERT INTO productos (nombre, modulo_id, precio, costo, unidad_medida, categoria_id, descripcion, es_para_llevar)
     VALUES ($1, (SELECT id FROM modulos WHERE slug = 'migao'), $2, $3, $4, $5, $6, $7)
     RETURNING id, nombre, precio, costo, unidad_medida, categoria_id, descripcion, activo, es_para_llevar`,
    [
      params.nombre,
      params.precio,
      params.costo,
      params.unidadMedida,
      params.categoriaId ?? null,
      params.descripcion ?? null,
      params.esParaLlevar,
    ],
  );
  return result.rows[0];
}

/** Listado completo (activos e inactivos) para la pantalla de administración del menú. */
/** Incluye, por producto, la receta de ingredientes de inventario que
 *  consume (para mostrarla como descripción ligera en la vista de Menú) —
 *  '[]' si no tiene ninguno asociado. */
export async function listProductosMigaoAdmin() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.costo, p.unidad_medida, p.imagen_url, p.categoria_id,
            p.descripcion, cp.nombre AS categoria_nombre, p.activo, p.es_para_llevar,
            COALESCE(
              json_agg(
                json_build_object(
                  'nombre', ip.nombre,
                  'cantidadPorUnidad', mpi.cantidad_por_unidad,
                  'unidadMedida', ip.unidad_medida
                )
              ) FILTER (WHERE mpi.id IS NOT NULL),
              '[]'
            ) AS ingredientes
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
       LEFT JOIN migao_producto_ingredientes mpi ON mpi.producto_id = p.id
       LEFT JOIN migao_inventario_productos ip ON ip.id = mpi.inventario_producto_id
      WHERE m.slug = 'migao'
      GROUP BY p.id, cp.nombre
      ORDER BY cp.nombre ASC NULLS LAST, p.nombre ASC`,
  );
  return result.rows;
}

export async function listCategoriasProducto() {
  const result = await pool.query(`SELECT id, nombre FROM categorias_producto ORDER BY nombre ASC`);
  return result.rows;
}

export async function crearCategoriaProducto(nombre: string) {
  const result = await pool.query(
    `INSERT INTO categorias_producto (nombre) VALUES ($1) RETURNING id, nombre`,
    [nombre],
  );
  return result.rows[0];
}

export async function actualizarImagenProductoMigao(id: string, imagenUrl: string) {
  const result = await pool.query(
    `UPDATE productos SET imagen_url = $2 WHERE id = $1
     RETURNING id, nombre, precio, costo, unidad_medida, imagen_url, categoria_id, descripcion, activo`,
    [id, imagenUrl],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function actualizarProductoMigao(
  id: string,
  data: {
    nombre?: string;
    precio?: number;
    costo?: number;
    unidadMedida?: string;
    categoriaId?: number | null;
    descripcion?: string;
    activo?: boolean;
    esParaLlevar?: boolean;
  },
) {
  const result = await pool.query(
    `UPDATE productos SET
       nombre = COALESCE($2, nombre),
       precio = COALESCE($3, precio),
       costo = COALESCE($4, costo),
       unidad_medida = COALESCE($5, unidad_medida),
       categoria_id = COALESCE($6, categoria_id),
       descripcion = COALESCE($7, descripcion),
       activo = COALESCE($8, activo),
       es_para_llevar = COALESCE($9, es_para_llevar)
     WHERE id = $1
     RETURNING id, nombre, precio, costo, unidad_medida, imagen_url, categoria_id, descripcion, activo, es_para_llevar`,
    [
      id,
      data.nombre ?? null,
      data.precio ?? null,
      data.costo ?? null,
      data.unidadMedida ?? null,
      data.categoriaId ?? null,
      data.descripcion ?? null,
      data.activo ?? null,
      data.esParaLlevar ?? null,
    ],
  );
  return result.rowCount ? result.rows[0] : null;
}

/** Cola de cocina: ítems de órdenes activas que aún no han sido servidos. */
export async function listItemsCocina() {
  const result = await pool.query(
    `SELECT oi.id, oi.orden_id, oi.cantidad, oi.estado, oi.listo_cocina, oi.created_at, oi.observaciones,
            p.nombre AS producto_nombre, p.descripcion AS producto_descripcion,
            m.numero AS mesa_numero, m.piso AS mesa_piso,
            u.nombre AS mesero_nombre
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
       JOIN ordenes o ON o.id = oi.orden_id
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
      WHERE oi.estado IN ('pendiente', 'preparando')
        AND o.estado NOT IN ('cerrada', 'cancelada')
        -- Los cargos "para llevar" (envases) los agrega el Cajero al cobrar,
        -- no son comida que Cocina deba preparar.
        AND p.es_para_llevar = false
      ORDER BY oi.created_at ASC`,
  );
  return result.rows;
}

/**
 * Historial de "despachados" para Cocina: ítems que Cocina ya dejó listos (estado
 * listo o servido), sin importar si el mesero ya los marcó entregados. No hay una
 * columna de "cuándo pasó a listo" en el esquema, así que se ordena por
 * `created_at` del ítem (cuándo se agregó a la orden) — aproximación razonable
 * dado que no se justifica una migración solo para esta pantalla de consulta.
 */
export async function listItemsDespachados() {
  const result = await pool.query(
    `SELECT oi.id, oi.orden_id, oi.cantidad, oi.estado, oi.listo_cocina, oi.created_at, oi.observaciones,
            p.nombre AS producto_nombre, m.numero AS mesa_numero, m.piso AS mesa_piso,
            u.nombre AS mesero_nombre
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
       JOIN ordenes o ON o.id = oi.orden_id
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
      WHERE oi.estado IN ('listo', 'servido')
      ORDER BY oi.created_at DESC
      LIMIT 300`,
  );
  return result.rows;
}

/**
 * Cocina empieza a preparar TODA la orden de una vez: todo lo pendiente pasa a
 * preparando. Los cargos "para llevar" (envases) quedan afuera: nunca pasan
 * por Cocina (ver el mismo filtro en listItemsCocina), así que tampoco deben
 * entrar a este flujo de preparando/check/listo — si entraran, Cocina nunca
 * podría marcarles el check (ni siquiera los ve) y marcarOrdenLista quedaría
 * bloqueada para siempre esperando un check que nadie puede poner.
 */
export async function empezarPreparar(ordenId: string, executor: Executor = pool) {
  const result = await executor.query(
    `UPDATE orden_items oi
        SET estado = 'preparando'
       FROM productos p
      WHERE oi.producto_id = p.id
        AND oi.orden_id = $1
        AND oi.estado = 'pendiente'
        AND p.es_para_llevar = false
      RETURNING oi.*`,
    [ordenId],
  );
  return result.rows;
}

/** Check individual del cocinero para un producto, mientras la orden está en preparando. */
export async function setCheckItem(itemId: string, listoCocina: boolean) {
  const result = await pool.query(
    `UPDATE orden_items SET listo_cocina = $2 WHERE id = $1 AND estado = 'preparando' RETURNING *`,
    [itemId, listoCocina],
  );
  return result.rows[0];
}

/** Marca TODA la orden como lista: solo debe llamarse cuando ya se validó que todo está checkeado. */
export async function marcarItemsListos(ordenId: string, executor: Executor = pool) {
  const result = await executor.query(
    `UPDATE orden_items SET estado = 'listo' WHERE orden_id = $1 AND estado = 'preparando' RETURNING *`,
    [ordenId],
  );
  return result.rows;
}

/**
 * Ítems visibles para el mesero: pendiente/preparando/listo de órdenes activas
 * (todo lo que no sea servido/cancelado). El frontend hace polling de esto para
 * detectar cuándo cocina cambia un ítem a preparando/listo y notificar con sonido.
 */
export async function listItemsActivos() {
  const result = await pool.query(
    `SELECT oi.id, oi.orden_id, oi.cantidad, oi.estado, oi.created_at,
            p.nombre AS producto_nombre, m.numero AS mesa_numero, m.piso AS mesa_piso, o.comensal_numero,
            u.nombre AS mesero_nombre
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
       JOIN ordenes o ON o.id = oi.orden_id
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
      WHERE oi.estado IN ('pendiente', 'preparando', 'listo')
        AND o.estado NOT IN ('cerrada', 'cancelada')
      ORDER BY oi.created_at ASC`,
  );
  return result.rows;
}

export async function getItemById(itemId: string) {
  const result = await pool.query(`SELECT * FROM orden_items WHERE id = $1`, [itemId]);
  return result.rowCount ? result.rows[0] : null;
}

export async function updateItemEstado(itemId: string, estado: string, executor: Executor = pool) {
  const result = await executor.query(`UPDATE orden_items SET estado = $2 WHERE id = $1 RETURNING *`, [
    itemId,
    estado,
  ]);
  return result.rows[0];
}

/**
 * Editar la cantidad regresa el ítem a "pendiente" (aunque ya estuviera
 * preparando/listo/servido) y le quita el check: cocina necesita volver a verlo,
 * prepararlo y marcarlo de nuevo, y el mesero recibe notificación cuando cocina
 * lo procese otra vez.
 */
export async function updateItemCantidad(
  itemId: string,
  cantidad: number,
  observaciones: string | undefined,
  executor: Executor = pool,
) {
  const result = await executor.query(
    `UPDATE orden_items
        SET cantidad = $2, estado = 'pendiente', listo_cocina = false, observaciones = COALESCE($3, observaciones)
      WHERE id = $1 RETURNING *`,
    [itemId, cantidad, observaciones ?? null],
  );
  return result.rows[0];
}

/** Corrige solo la nota del ítem (ej. "sin azúcar"), sin tocar cantidad ni estado. */
export async function updateItemObservaciones(itemId: string, observaciones: string, executor: Executor = pool) {
  const result = await executor.query(
    `UPDATE orden_items SET observaciones = $2 WHERE id = $1 RETURNING *`,
    [itemId, observaciones],
  );
  return result.rows[0];
}

export async function agregarItem(
  ordenId: string,
  productoId: string,
  cantidad: number,
  precioUnitario: number,
  observaciones?: string,
  executor: Executor = pool,
) {
  const result = await executor.query(
    `INSERT INTO orden_items (orden_id, producto_id, cantidad, precio_unitario, observaciones)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ordenId, productoId, cantidad, precioUnitario, observaciones ?? null],
  );
  return result.rows[0];
}

export async function insertHistorial(
  executor: Executor,
  params: {
    ordenId: string;
    ordenItemId?: number;
    accion:
      | "item_agregado"
      | "item_editado"
      | "item_cancelado"
      | "item_entregado"
      | "item_preparando"
      | "item_listo";
    detalle?: Record<string, unknown>;
    usuarioId: string;
  },
) {
  await executor.query(
    `INSERT INTO orden_historial (orden_id, orden_item_id, accion, detalle, usuario_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.ordenId,
      params.ordenItemId ?? null,
      params.accion,
      params.detalle ? JSON.stringify(params.detalle) : null,
      params.usuarioId,
    ],
  );
}

export async function getHistorialPorOrden(ordenId: string) {
  const result = await pool.query(
    `SELECT h.id, h.orden_item_id, h.accion, h.detalle, h.created_at, u.nombre AS usuario_nombre,
            p.nombre AS producto_nombre
       FROM orden_historial h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       LEFT JOIN orden_items oi ON oi.id = h.orden_item_id
       LEFT JOIN productos p ON p.id = oi.producto_id
      WHERE h.orden_id = $1
      ORDER BY h.created_at DESC`,
    [ordenId],
  );
  return result.rows;
}

export async function getOrdenById(ordenId: string, executor: Executor = pool, forUpdate = false) {
  const result = await executor.query(
    `SELECT * FROM ordenes WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [ordenId],
  );
  return result.rowCount ? result.rows[0] : null;
}

/** Cambia la mesa de una orden ya creada (ej. los comensales se cambiaron de
 *  mesa a mitad del pedido). No toca nada más de la orden. */
export async function actualizarMesaOrden(ordenId: string, mesaId: number, executor: Executor = pool) {
  const result = await executor.query(`UPDATE ordenes SET mesa_id = $2 WHERE id = $1 RETURNING *`, [
    ordenId,
    mesaId,
  ]);
  return result.rows[0];
}

export async function getItemsPorOrden(ordenId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT oi.*, p.nombre AS producto_nombre, p.es_para_llevar
       FROM orden_items oi
       JOIN productos p ON p.id = oi.producto_id
      WHERE oi.orden_id = $1
      ORDER BY oi.created_at ASC`,
    [ordenId],
  );
  return result.rows;
}

export async function cerrarOrdenEstado(client: PoolClient, ordenId: string) {
  await client.query(`UPDATE ordenes SET estado = 'cerrada', closed_at = now() WHERE id = $1`, [ordenId]);
}

export async function cancelarOrdenEstado(client: PoolClient, ordenId: string) {
  await client.query(`UPDATE ordenes SET estado = 'cancelada', closed_at = now() WHERE id = $1`, [ordenId]);
}

export async function crearVenta(
  client: PoolClient,
  params: {
    clienteId: string | null;
    usuarioId: string;
    ordenId: string;
    subtotal: number;
    descuento: number;
    descuentoPorcentaje: number;
    total: number;
  },
) {
  const result = await client.query(
    `INSERT INTO ventas (modulo_id, cliente_id, usuario_id, orden_id, subtotal, descuento, descuento_porcentaje, total)
     VALUES ((SELECT id FROM modulos WHERE slug = 'migao'), $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.clienteId,
      params.usuarioId,
      params.ordenId,
      params.subtotal,
      params.descuento,
      params.descuentoPorcentaje,
      params.total,
    ],
  );
  return result.rows[0];
}

export async function crearVentaItems(
  client: PoolClient,
  ventaId: string,
  items: { productoId: string; cantidad: number; precioUnitario: number }[],
) {
  for (const item of items) {
    await client.query(
      `INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)`,
      [ventaId, item.productoId, item.cantidad, item.precioUnitario],
    );
  }
}

export async function crearPago(
  client: PoolClient,
  params: {
    ordenId: string;
    ventaId: string;
    metodoPago: string;
    monto: number;
    referencia?: string;
    usuarioId: string;
  },
) {
  const result = await client.query(
    `INSERT INTO pagos (orden_id, venta_id, metodo_pago, monto, referencia, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [params.ordenId, params.ventaId, params.metodoPago, params.monto, params.referencia ?? null, params.usuarioId],
  );
  return result.rows[0];
}

/** Propina opcional al cobrar — dinero del mesero/personal, nunca toca
 *  movimientos_caja/turnos_caja (ver comentario en schema.sql). */
export async function crearPropina(
  client: PoolClient,
  params: {
    ordenId: string;
    ventaId: string;
    meseroId: string | null;
    usuarioId: string;
    monto: number;
    porcentaje: number | null;
    metodoPago: "efectivo" | "banco";
  },
) {
  const result = await client.query(
    `INSERT INTO migao_propinas (orden_id, venta_id, mesero_id, usuario_id, monto, porcentaje, metodo_pago)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      params.ordenId,
      params.ventaId,
      params.meseroId,
      params.usuarioId,
      params.monto,
      params.porcentaje,
      params.metodoPago,
    ],
  );
  return result.rows[0];
}

export async function listPropinas() {
  const result = await pool.query(
    `SELECT p.id, p.orden_id, p.venta_id, p.monto, p.porcentaje, p.metodo_pago, p.created_at,
            l.created_at AS liquidada_en,
            m.numero AS mesa_numero, m.piso AS mesa_piso, u.nombre AS mesero_nombre
       FROM migao_propinas p
       LEFT JOIN ordenes o ON o.id = p.orden_id
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = p.mesero_id
       LEFT JOIN migao_propinas_liquidaciones l ON l.id = p.liquidacion_id
      ORDER BY p.created_at DESC
      LIMIT 500`,
  );
  return result.rows;
}

/** Cuánto hay pendiente de repartir de un método (efectivo/banco) — se
 *  recalcula siempre en vivo, nunca se guarda aparte (ver migao_propinas.liquidacion_id). */
export async function sumPropinasPendientes(client: PoolClient, metodoPago: "efectivo" | "banco") {
  const result = await client.query(
    `SELECT COALESCE(SUM(monto), 0) AS pendiente
       FROM migao_propinas
      WHERE metodo_pago = $1 AND liquidacion_id IS NULL`,
    [metodoPago],
  );
  return Number(result.rows[0].pendiente);
}

export async function crearLiquidacionPropinas(
  client: PoolClient,
  params: { metodoPago: "efectivo" | "banco"; monto: number; nota?: string; usuarioId: string },
) {
  const result = await client.query(
    `INSERT INTO migao_propinas_liquidaciones (metodo_pago, monto, nota, usuario_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.metodoPago, params.monto, params.nota ?? null, params.usuarioId],
  );
  return result.rows[0];
}

export async function marcarPropinasLiquidadas(
  client: PoolClient,
  params: { metodoPago: "efectivo" | "banco"; liquidacionId: string },
) {
  await client.query(
    `UPDATE migao_propinas SET liquidacion_id = $1 WHERE metodo_pago = $2 AND liquidacion_id IS NULL`,
    [params.liquidacionId, params.metodoPago],
  );
}

/**
 * Borra por completo el historial de órdenes de Migao: pagos, movimientos de
 * Caja generados por esas ventas, las ventas mismas, las órdenes (con cascada
 * automática a orden_items/orden_historial), y también los ingresos manuales de
 * Migao que Caja haya subido a mano (los mismos que aparecen mezclados en
 * `listarHistorialOrdenes` vía `listIngresosManualesMigao` — si el reset no los
 * tocara, quedarían huérfanos en el historial de pedidos después de "borrar
 * todo"). Todo escopado por `orden_id`/`modulo_origen = migao` para no tocar
 * ventas/pagos/movimientos que en el futuro pudiera generar Con Sentido. No es
 * reversible — a diferencia del reset de Caja, acá no existe un mecanismo de
 * "conservar historial" porque no hay pantalla de reportes de órdenes (ver
 * caja.repository.ts para el contraste).
 */
export async function resetearOrdenesCompleto() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movimientosVentas = await client.query(
      `DELETE FROM movimientos_caja
        WHERE referencia_entidad = 'ventas'
          AND referencia_id IN (SELECT id::text FROM ventas WHERE orden_id IS NOT NULL)`,
    );
    const movimientosManuales = await client.query(
      `DELETE FROM movimientos_caja
        WHERE modulo_origen_id = (SELECT id FROM modulos WHERE slug = 'migao')
          AND tipo = 'ingreso'
          AND referencia_entidad IS DISTINCT FROM 'ventas'`,
    );
    const pagos = await client.query(`DELETE FROM pagos WHERE orden_id IS NOT NULL`);
    const ventas = await client.query(`DELETE FROM ventas WHERE orden_id IS NOT NULL`);
    const ordenes = await client.query(`DELETE FROM ordenes`);

    await client.query("COMMIT");
    return {
      ordenesBorradas: ordenes.rowCount ?? 0,
      ventasBorradas: ventas.rowCount ?? 0,
      pagosBorrados: pagos.rowCount ?? 0,
      movimientosCajaBorrados: (movimientosVentas.rowCount ?? 0) + (movimientosManuales.rowCount ?? 0),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reinicio total exclusivo de Super Root: borra TODO el historial transaccional
 * de Migao y de Caja General (órdenes, ventas, pagos, turnos y movimientos de
 * caja de cualquier módulo, no solo Migao) — deja el negocio como recién
 * instalado. Lo único que se conserva es el catálogo (productos, categorías),
 * usuarios y roles/permisos.
 *
 * Orden de borrado (importa por las foreign keys): movimientos_caja depende de
 * turnos_caja; pagos y ventas dependen de ordenes; hay que borrar los hijos
 * antes que los padres o Postgres rechaza el DELETE.
 */
export async function reiniciarTodoCompleto() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const movimientos = await client.query(`DELETE FROM movimientos_caja`);
    const pagos = await client.query(`DELETE FROM pagos WHERE orden_id IS NOT NULL`);
    const ventas = await client.query(`DELETE FROM ventas WHERE orden_id IS NOT NULL`);
    const ordenes = await client.query(`DELETE FROM ordenes`);
    const turnos = await client.query(`DELETE FROM turnos_caja`);

    await client.query("COMMIT");
    return {
      ordenesBorradas: ordenes.rowCount ?? 0,
      ventasBorradas: ventas.rowCount ?? 0,
      pagosBorrados: pagos.rowCount ?? 0,
      movimientosCajaBorrados: movimientos.rowCount ?? 0,
      turnosBorrados: turnos.rowCount ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// Factura imprimible: reconstruye lo cobrado de una orden ya cerrada a partir
// de ventas/venta_items/pagos/migao_propinas — nunca toca la transacción de
// cerrarOrden, solo lee lo que ya quedó guardado ahí.
// ============================================================================

export async function getVentaPorOrdenId(ordenId: string) {
  const result = await pool.query(`SELECT * FROM ventas WHERE orden_id = $1`, [ordenId]);
  return result.rowCount ? result.rows[0] : null;
}

/** Resuelve el orden_id de una venta a partir de su id — usado para reimprimir
 *  la factura desde Caja General (donde los movimientos guardan `referencia_id`
 *  = venta.id, no el orden_id). Null si la venta no es de Migao (sin orden). */
export async function getOrdenIdPorVentaId(ventaId: string) {
  const result = await pool.query(`SELECT orden_id FROM ventas WHERE id = $1 AND orden_id IS NOT NULL`, [ventaId]);
  return result.rowCount ? (result.rows[0].orden_id as string) : null;
}

export async function getOrdenParaFactura(ordenId: string) {
  const result = await pool.query(
    `SELECT o.id, o.comensal_numero, o.numero_personas, o.created_at, o.closed_at,
            m.numero AS mesa_numero, m.piso AS mesa_piso, u.nombre AS mesero_nombre
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
      WHERE o.id = $1`,
    [ordenId],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function getVentaItems(ventaId: string) {
  const result = await pool.query(
    `SELECT vi.id, vi.producto_id, p.nombre AS producto_nombre, vi.cantidad, vi.precio_unitario, vi.subtotal
       FROM venta_items vi
       JOIN productos p ON p.id = vi.producto_id
      WHERE vi.venta_id = $1
      ORDER BY vi.id ASC`,
    [ventaId],
  );
  return result.rows;
}

export async function getPagosPorVenta(ventaId: string) {
  const result = await pool.query(
    `SELECT id, metodo_pago, monto, referencia, created_at
       FROM pagos
      WHERE venta_id = $1
      ORDER BY created_at ASC`,
    [ventaId],
  );
  return result.rows;
}

export async function getPropinaPorVenta(ventaId: string) {
  const result = await pool.query(
    `SELECT monto, porcentaje, metodo_pago FROM migao_propinas WHERE venta_id = $1`,
    [ventaId],
  );
  return result.rowCount ? result.rows[0] : null;
}

/** Get-or-create idempotente: la primera vez que se pide la factura de una
 *  venta se le asigna el siguiente número de `facturas_numero_seq` (nunca se
 *  reutiliza); reimprimir después siempre devuelve la misma fila. El índice
 *  único en `venta_id` blinda contra doble clic/pedidos simultáneos. */
export async function getOrCrearFactura(
  params: {
    ventaId: string;
    ordenId: string;
    subtotal: number;
    total: number;
  },
  executor: Executor = pool,
) {
  const insert = await executor.query(
    `INSERT INTO facturas (venta_id, orden_id, numero, tipo, subtotal, total)
     VALUES ($1, $2, 'F-' || lpad(nextval('facturas_numero_seq')::text, 6, '0'), 'factura', $3, $4)
     ON CONFLICT (venta_id) WHERE venta_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [params.ventaId, params.ordenId, params.subtotal, params.total],
  );
  if (insert.rowCount) return insert.rows[0];

  const existente = await executor.query(`SELECT * FROM facturas WHERE venta_id = $1`, [params.ventaId]);
  return existente.rows[0];
}

// ============================================================================
// Cotizaciones: presupuesto para un cliente ANTES de una orden/venta real —
// vive completamente aparte, nunca toca ordenes/ventas/inventario/caja.
// ============================================================================

export async function crearCotizacion(params: {
  clienteNombre?: string;
  clienteTelefono?: string;
  nota?: string;
  subtotal: number;
  total: number;
  usuarioId: string;
}) {
  const result = await pool.query(
    `INSERT INTO migao_cotizaciones (cliente_nombre, cliente_telefono, nota, subtotal, total, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.clienteNombre ?? null,
      params.clienteTelefono ?? null,
      params.nota ?? null,
      params.subtotal,
      params.total,
      params.usuarioId,
    ],
  );
  return result.rows[0];
}

export async function crearCotizacionItems(
  cotizacionId: string,
  items: { nombre: string; cantidad: number; precioUnitario: number }[],
) {
  for (const item of items) {
    await pool.query(
      `INSERT INTO migao_cotizacion_items (cotizacion_id, nombre, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)`,
      [cotizacionId, item.nombre, item.cantidad, item.precioUnitario],
    );
  }
}

export async function listCotizaciones() {
  const result = await pool.query(
    `SELECT c.id, c.numero, c.cliente_nombre, c.cliente_telefono, c.nota, c.subtotal, c.total, c.created_at,
            u.nombre AS usuario_nombre
       FROM migao_cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.created_at DESC
      LIMIT 500`,
  );
  return result.rows;
}

export async function getCotizacionPorId(id: string) {
  const cotizacion = await pool.query(
    `SELECT c.id, c.numero, c.cliente_nombre, c.cliente_telefono, c.nota, c.subtotal, c.total, c.created_at,
            u.nombre AS usuario_nombre
       FROM migao_cotizaciones c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.id = $1`,
    [id],
  );
  if (!cotizacion.rowCount) return null;

  const items = await pool.query(
    `SELECT id, nombre, cantidad, precio_unitario, subtotal
       FROM migao_cotizacion_items
      WHERE cotizacion_id = $1
      ORDER BY id ASC`,
    [id],
  );
  return { ...cotizacion.rows[0], items: items.rows };
}

export async function eliminarCotizacion(id: string) {
  const result = await pool.query(`DELETE FROM migao_cotizaciones WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
