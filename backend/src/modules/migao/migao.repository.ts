import { Pool, PoolClient } from "pg";
import { pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

export async function listMesas() {
  const result = await pool.query(
    `SELECT id, zona_id, numero, piso, capacidad, estado FROM mesas ORDER BY piso ASC, numero ASC`,
  );
  return result.rows;
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
    `SELECT o.id, o.estado, o.created_at, o.comensal_numero, o.numero_personas,
            m.numero AS mesa_numero, m.piso AS mesa_piso, c.nombre AS cliente_nombre,
            u.nombre AS mesero_nombre,
            COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS total
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
       LEFT JOIN orden_items oi ON oi.orden_id = o.id AND oi.estado != 'cancelado'
      WHERE o.estado NOT IN ('cerrada', 'cancelada')
      GROUP BY o.id, o.estado, o.created_at, o.comensal_numero, o.numero_personas, m.numero, m.piso, c.nombre, u.nombre
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
            COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) AS total
       FROM ordenes o
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
       LEFT JOIN orden_items oi ON oi.orden_id = o.id AND oi.estado != 'cancelado'
       LEFT JOIN ventas v ON v.orden_id = o.id
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
      GROUP BY o.id, o.estado, o.created_at, o.closed_at, o.comensal_numero, o.numero_personas, m.numero, m.piso,
               c.nombre, u.nombre
      ORDER BY o.closed_at DESC
      LIMIT 200`,
    [meseroId ?? null],
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

export async function listProductosMigao() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.categoria_id, p.descripcion, cp.nombre AS categoria_nombre
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
      WHERE m.slug = 'migao' AND p.activo = true
      ORDER BY cp.nombre ASC NULLS LAST, p.nombre ASC`,
  );
  return result.rows;
}

export async function crearProductoMigao(params: {
  nombre: string;
  precio: number;
  costo: number;
  unidadMedida: string;
  categoriaId?: number;
  descripcion?: string;
}) {
  const result = await pool.query(
    `INSERT INTO productos (nombre, modulo_id, precio, costo, unidad_medida, categoria_id, descripcion)
     VALUES ($1, (SELECT id FROM modulos WHERE slug = 'migao'), $2, $3, $4, $5, $6)
     RETURNING id, nombre, precio, costo, unidad_medida, categoria_id, descripcion, activo`,
    [
      params.nombre,
      params.precio,
      params.costo,
      params.unidadMedida,
      params.categoriaId ?? null,
      params.descripcion ?? null,
    ],
  );
  return result.rows[0];
}

/** Listado completo (activos e inactivos) para la pantalla de administración del menú. */
export async function listProductosMigaoAdmin() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.costo, p.unidad_medida, p.imagen_url, p.categoria_id,
            p.descripcion, cp.nombre AS categoria_nombre, p.activo
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
      WHERE m.slug = 'migao'
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
       activo = COALESCE($8, activo)
     WHERE id = $1
     RETURNING id, nombre, precio, costo, unidad_medida, imagen_url, categoria_id, descripcion, activo`,
    [
      id,
      data.nombre ?? null,
      data.precio ?? null,
      data.costo ?? null,
      data.unidadMedida ?? null,
      data.categoriaId ?? null,
      data.descripcion ?? null,
      data.activo ?? null,
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
    `SELECT oi.id, oi.orden_id, oi.cantidad, oi.estado, oi.listo_cocina, oi.created_at,
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

/** Cocina empieza a preparar TODA la orden de una vez: todo lo pendiente pasa a preparando. */
export async function empezarPreparar(ordenId: string) {
  const result = await pool.query(
    `UPDATE orden_items SET estado = 'preparando' WHERE orden_id = $1 AND estado = 'pendiente' RETURNING *`,
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
export async function marcarItemsListos(ordenId: string) {
  const result = await pool.query(
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
export async function updateItemCantidad(itemId: string, cantidad: number) {
  const result = await pool.query(
    `UPDATE orden_items SET cantidad = $2, estado = 'pendiente', listo_cocina = false WHERE id = $1 RETURNING *`,
    [itemId, cantidad],
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
    accion: "item_agregado" | "item_editado" | "item_cancelado" | "item_entregado";
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

export async function getItemsPorOrden(ordenId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT oi.*, p.nombre AS producto_nombre
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
  params: { clienteId: string | null; usuarioId: string; ordenId: string; subtotal: number; total: number },
) {
  const result = await client.query(
    `INSERT INTO ventas (modulo_id, cliente_id, usuario_id, orden_id, subtotal, total)
     VALUES ((SELECT id FROM modulos WHERE slug = 'migao'), $1, $2, $3, $4, $5)
     RETURNING *`,
    [params.clienteId, params.usuarioId, params.ordenId, params.subtotal, params.total],
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
