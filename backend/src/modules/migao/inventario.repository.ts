import { Pool, PoolClient } from "pg";
import { pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

export interface InventarioProducto {
  id: string;
  nombre: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  unidad_medida: string;
  unidades_por_paquete: string;
  tamano_unidad: string | null;
  costo_paquete: string | null;
  stock_unidades: string;
  stock_minimo_unidades: string | null;
  activo: boolean;
  created_at: string;
}

const COLUMNAS_PRODUCTO = `ip.*, ic.nombre AS categoria_nombre`;

export async function listProductos(): Promise<InventarioProducto[]> {
  const result = await pool.query(
    `SELECT ${COLUMNAS_PRODUCTO}
       FROM migao_inventario_productos ip
       LEFT JOIN migao_inventario_categorias ic ON ic.id = ip.categoria_id
      ORDER BY ip.nombre ASC`,
  );
  return result.rows;
}

export async function getProductoById(id: string, executor: Executor = pool): Promise<InventarioProducto | null> {
  const result = await executor.query(
    `SELECT ${COLUMNAS_PRODUCTO}
       FROM migao_inventario_productos ip
       LEFT JOIN migao_inventario_categorias ic ON ic.id = ip.categoria_id
      WHERE ip.id = $1`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function crearProducto(params: {
  nombre: string;
  categoriaId?: number;
  unidadMedida: string;
  unidadesPorPaquete: number;
  tamanoUnidad?: string;
  costoPaquete?: number;
  stockMinimoUnidades?: number;
}): Promise<InventarioProducto> {
  const result = await pool.query(
    `INSERT INTO migao_inventario_productos
       (nombre, categoria_id, unidad_medida, unidades_por_paquete, tamano_unidad, costo_paquete, stock_minimo_unidades)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.nombre,
      params.categoriaId ?? null,
      params.unidadMedida,
      params.unidadesPorPaquete,
      params.tamanoUnidad ?? null,
      params.costoPaquete ?? null,
      params.stockMinimoUnidades ?? null,
    ],
  );
  return (await getProductoById(result.rows[0].id))!;
}

export async function actualizarProducto(
  id: string,
  params: {
    nombre?: string;
    categoriaId?: number;
    unidadMedida?: string;
    unidadesPorPaquete?: number;
    tamanoUnidad?: string;
    costoPaquete?: number;
    stockMinimoUnidades?: number;
    activo?: boolean;
  },
): Promise<InventarioProducto | null> {
  const result = await pool.query(
    `UPDATE migao_inventario_productos
        SET nombre = COALESCE($2, nombre),
            categoria_id = COALESCE($3, categoria_id),
            unidad_medida = COALESCE($4, unidad_medida),
            unidades_por_paquete = COALESCE($5, unidades_por_paquete),
            tamano_unidad = COALESCE($6, tamano_unidad),
            costo_paquete = COALESCE($7, costo_paquete),
            stock_minimo_unidades = COALESCE($8, stock_minimo_unidades),
            activo = COALESCE($9, activo)
      WHERE id = $1
      RETURNING id`,
    [
      id,
      params.nombre ?? null,
      params.categoriaId ?? null,
      params.unidadMedida ?? null,
      params.unidadesPorPaquete ?? null,
      params.tamanoUnidad ?? null,
      params.costoPaquete ?? null,
      params.stockMinimoUnidades ?? null,
      params.activo ?? null,
    ],
  );
  if (!result.rowCount) return null;
  return getProductoById(id);
}

export async function listCategoriasInventario() {
  const result = await pool.query(`SELECT id, nombre FROM migao_inventario_categorias ORDER BY nombre ASC`);
  return result.rows;
}

export async function crearCategoriaInventario(nombre: string) {
  const result = await pool.query(
    `INSERT INTO migao_inventario_categorias (nombre) VALUES ($1) RETURNING id, nombre`,
    [nombre],
  );
  return result.rows[0];
}

/**
 * Borrado físico — solo tiene éxito si el producto no tiene movimientos ni
 * recetas asociadas (las FK sin ON DELETE CASCADE lo impiden con un 23503).
 * Si ya tiene historial, el llamador debe ofrecer "Desactivar" en su lugar.
 */
export async function eliminarProducto(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM migao_inventario_productos WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Borrado forzado (exclusivo de Super Root, ver inventario.service.ts): borra
 * también sus movimientos y sus vínculos de receta antes de borrar la fila —
 * permanente e irreversible, a propósito no queda ningún rastro.
 */
export async function eliminarProductoForzado(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM migao_inventario_movimientos WHERE producto_id = $1`, [id]);
    await client.query(`DELETE FROM migao_producto_ingredientes WHERE inventario_producto_id = $1`, [id]);
    const result = await client.query(`DELETE FROM migao_inventario_productos WHERE id = $1`, [id]);
    await client.query("COMMIT");
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aplica un delta (positivo o negativo) al stock en unidades — nunca bloquea:
 * se permite quedar en negativo (el usuario decidió que avisar es mejor que
 * frenar una venta por un inventario que puede estar mal contado). Quien
 * llama decide si el resultado amerita una alerta visual.
 */
export async function ajustarStock(
  executor: Executor,
  productoId: string,
  deltaUnidades: number,
): Promise<InventarioProducto | null> {
  const result = await executor.query(
    `UPDATE migao_inventario_productos
        SET stock_unidades = stock_unidades + $2
      WHERE id = $1
      RETURNING *`,
    [productoId, deltaUnidades],
  );
  return result.rowCount ? result.rows[0] : null;
}

export interface InventarioMovimiento {
  id: number;
  producto_id: string;
  tipo: "entrada" | "ajuste" | "consumo";
  cantidad_unidades: string;
  motivo: string | null;
  referencia_entidad: string | null;
  referencia_id: string | null;
  usuario_id: string;
  usuario_nombre?: string | null;
  created_at: string;
}

export async function insertMovimiento(
  executor: Executor,
  params: {
    productoId: string;
    tipo: "entrada" | "ajuste" | "consumo";
    cantidadUnidades: number;
    motivo?: string;
    referenciaEntidad?: string;
    referenciaId?: string;
    usuarioId: string;
  },
): Promise<InventarioMovimiento> {
  const result = await executor.query(
    `INSERT INTO migao_inventario_movimientos
       (producto_id, tipo, cantidad_unidades, motivo, referencia_entidad, referencia_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.productoId,
      params.tipo,
      params.cantidadUnidades,
      params.motivo ?? null,
      params.referenciaEntidad ?? null,
      params.referenciaId ?? null,
      params.usuarioId,
    ],
  );
  return result.rows[0];
}

export async function listMovimientosPorProducto(productoId: string): Promise<InventarioMovimiento[]> {
  const result = await pool.query(
    `SELECT mi.*, u.nombre AS usuario_nombre
       FROM migao_inventario_movimientos mi
       LEFT JOIN usuarios u ON u.id = mi.usuario_id
      WHERE mi.producto_id = $1
      ORDER BY mi.created_at DESC
      LIMIT 200`,
    [productoId],
  );
  return result.rows;
}

/** Historial global (todos los productos) de un solo tipo de movimiento —
 *  'entrada' para el historial de ingresos, 'ajuste' para el de ajustes con
 *  motivo. Nunca 'consumo' acá (eso lo genera automáticamente cada venta,
 *  no es algo que alguien "registre" — se ve producto por producto si hace
 *  falta, vía listMovimientosPorProducto). */
export async function listMovimientosGlobalPorTipo(
  tipo: "entrada" | "ajuste",
): Promise<(InventarioMovimiento & { producto_nombre: string })[]> {
  const result = await pool.query(
    `SELECT mi.*, ip.nombre AS producto_nombre, u.nombre AS usuario_nombre
       FROM migao_inventario_movimientos mi
       JOIN migao_inventario_productos ip ON ip.id = mi.producto_id
       LEFT JOIN usuarios u ON u.id = mi.usuario_id
      WHERE mi.tipo = $1
      ORDER BY mi.created_at DESC
      LIMIT 300`,
    [tipo],
  );
  return result.rows;
}

export interface ConsumoInventarioEntrada {
  id: number;
  insumo_nombre: string;
  cantidad_unidades: string;
  unidad_medida: string;
  created_at: string;
  orden_id: string | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  orden_nombre: string | null;
  mesero_nombre: string | null;
  producto_nombre: string | null;
  cantidad_producto: string | null;
}

/** Historial de salidas de inventario por consumo automático de órdenes
 *  (nunca a mano, ver aplicarConsumoPorProducto en inventario.service.ts) —
 *  cada fila es un insumo descontado al servir un producto del menú, con la
 *  orden/mesa/mesero de dónde vino. */
export async function listMovimientosConsumoPorOrdenes(): Promise<ConsumoInventarioEntrada[]> {
  const result = await pool.query(
    `SELECT mi.id, ip.nombre AS insumo_nombre, mi.cantidad_unidades, ip.unidad_medida, mi.created_at,
            o.id AS orden_id, m.numero AS mesa_numero, m.piso AS mesa_piso, o.nombre AS orden_nombre,
            u.nombre AS mesero_nombre, p.nombre AS producto_nombre, oi.cantidad AS cantidad_producto
       FROM migao_inventario_movimientos mi
       JOIN migao_inventario_productos ip ON ip.id = mi.producto_id
       LEFT JOIN orden_items oi ON mi.referencia_entidad = 'orden_items' AND oi.id = mi.referencia_id::bigint
       LEFT JOIN productos p ON p.id = oi.producto_id
       LEFT JOIN ordenes o ON o.id = oi.orden_id
       LEFT JOIN mesas m ON m.id = o.mesa_id
       LEFT JOIN usuarios u ON u.id = o.mesero_id
      WHERE mi.tipo = 'consumo'
      ORDER BY mi.created_at DESC
      LIMIT 300`,
  );
  return result.rows;
}

export interface IngredienteProducto {
  id: number;
  productoId: string;
  inventarioProductoId: string;
  cantidadPorUnidad: string;
  nombre: string;
  unidadMedida: string;
}

/** Receta de un producto del menú: qué consume por cada unidad vendida. */
export async function listIngredientesDeProducto(
  productoId: string,
  executor: Executor = pool,
): Promise<IngredienteProducto[]> {
  const result = await executor.query(
    `SELECT pi.id, pi.producto_id, pi.inventario_producto_id, pi.cantidad_por_unidad,
            ip.nombre, ip.unidad_medida
       FROM migao_producto_ingredientes pi
       JOIN migao_inventario_productos ip ON ip.id = pi.inventario_producto_id
      WHERE pi.producto_id = $1`,
    [productoId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    productoId: row.producto_id,
    inventarioProductoId: row.inventario_producto_id,
    cantidadPorUnidad: row.cantidad_por_unidad,
    nombre: row.nombre,
    unidadMedida: row.unidad_medida,
  }));
}

/** Reemplaza toda la receta de un producto de una sola vez — más simple que
 *  diffear altas/bajas/cambios, y la lista de un producto siempre es chica. */
export async function reemplazarIngredientesDeProducto(
  client: PoolClient,
  productoId: string,
  ingredientes: { inventarioProductoId: string; cantidadPorUnidad: number }[],
) {
  await client.query(`DELETE FROM migao_producto_ingredientes WHERE producto_id = $1`, [productoId]);
  for (const ing of ingredientes) {
    await client.query(
      `INSERT INTO migao_producto_ingredientes (producto_id, inventario_producto_id, cantidad_por_unidad)
       VALUES ($1, $2, $3)`,
      [productoId, ing.inventarioProductoId, ing.cantidadPorUnidad],
    );
  }
}
