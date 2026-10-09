import { Pool, PoolClient, pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

// --------------------------------------------------------------------------
// Productos (tabla `productos` compartida con Migao, distinguida por
// modulo_id) + `inventario_productos` para el stock de producto terminado.
// --------------------------------------------------------------------------

// DECIMAL llega de MySQL como texto ("20000.00"): se pasa a número acá, una
// sola vez, para que el frontend y el validador de ventas (z.number()) reciban
// números de verdad.
function normalizarProducto<T extends Record<string, unknown>>(fila: T) {
  return {
    ...fila,
    precio: Number(fila.precio),
    stock: Number(fila.stock),
    precio_mayorista: fila.precio_mayorista == null ? null : Number(fila.precio_mayorista),
    mayorista_desde: fila.mayorista_desde == null ? null : Number(fila.mayorista_desde),
  };
}

// `grupo`: clave para sumar las variantes de un mismo producto del e-commerce al aplicar el
// mayorista (un producto creado a mano en el POS es su propio grupo).
const SELECT_PRODUCTO = `
  SELECT p.id, p.nombre, p.sku, p.precio, p.descripcion, p.imagen_url, p.activo,
         p.precio_mayorista, p.mayorista_desde, p.nota_mayorista,
         COALESCE(p.ecommerce_product_id, p.id) AS grupo,
         p.ecommerce_publicado, (p.ecommerce_item_key IS NOT NULL) AS sincronizado,
         cp.nombre AS categoria, COALESCE(ip.cantidad_actual, 0) AS stock
    FROM productos p
    LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
    LEFT JOIN inventario_productos ip ON ip.producto_id = p.id
`;

export async function listProductos() {
  const result = await pool.query(
    `${SELECT_PRODUCTO}
      JOIN modulos m ON m.id = p.modulo_id
      WHERE m.slug = 'con_sentido' AND p.activo = true
      ORDER BY p.nombre ASC`,
  );
  return result.rows.map(normalizarProducto);
}

/** Busca la categoría por nombre o la crea si no existe — así el formulario
 *  puede seguir mandando un nombre de categoría en texto libre (como ya
 *  hacía) sin que el usuario tenga que administrar un catálogo aparte. */
async function obtenerOCrearCategoria(nombre: string | undefined): Promise<number | null> {
  if (!nombre?.trim()) return null;
  const existente = await pool.query(`SELECT id FROM categorias_producto WHERE nombre = $1`, [nombre.trim()]);
  if (existente.rowCount) return existente.rows[0].id;
  const creada = await pool.query(
    `INSERT INTO categorias_producto (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [nombre.trim()],
  );
  return creada.rows[0].id;
}

export async function crearProducto(params: {
  nombre: string;
  precio: number;
  descripcion?: string;
  categoria?: string;
  imagenUrl?: string;
  stock: number;
}) {
  const categoriaId = await obtenerOCrearCategoria(params.categoria);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const producto = await client.query(
      `INSERT INTO productos (nombre, modulo_id, categoria_id, precio, descripcion, imagen_url)
       VALUES ($1, (SELECT id FROM modulos WHERE slug = 'con_sentido'), $2, $3, $4, $5)
       RETURNING id, nombre, precio, descripcion, imagen_url, activo`,
      [params.nombre, categoriaId, params.precio, params.descripcion ?? null, params.imagenUrl ?? null],
    );
    await client.query(`INSERT INTO inventario_productos (producto_id, cantidad_actual) VALUES ($1, $2)`, [
      producto.rows[0].id,
      params.stock,
    ]);
    await client.query("COMMIT");
    return { ...producto.rows[0], categoria: params.categoria ?? null, stock: params.stock };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getProductoConSentidoById(id: string) {
  const result = await pool.query(
    `SELECT p.id, p.categoria_id, p.sku, p.ecommerce_item_key, p.ecommerce_product_id, p.ecommerce_variant_id,
            COALESCE((SELECT ip.cantidad_actual FROM inventario_productos ip WHERE ip.producto_id = p.id), 0) AS stock
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
      WHERE p.id = $1 AND m.slug = 'con_sentido'`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function actualizarProducto(
  id: string,
  params: {
    nombre?: string;
    precio?: number;
    descripcion?: string;
    categoria?: string;
    imagenUrl?: string;
    stock?: number;
    activo?: boolean;
  },
) {
  const categoriaId = params.categoria !== undefined ? await obtenerOCrearCategoria(params.categoria) : undefined;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE productos
          SET nombre = COALESCE($2, nombre),
              precio = COALESCE($3, precio),
              descripcion = COALESCE($4, descripcion),
              categoria_id = COALESCE($5, categoria_id),
              imagen_url = COALESCE($6, imagen_url),
              activo = COALESCE($7, activo)
        WHERE id = $1
        RETURNING id`,
      [
        id,
        params.nombre ?? null,
        params.precio ?? null,
        params.descripcion ?? null,
        categoriaId ?? null,
        params.imagenUrl ?? null,
        params.activo ?? null,
      ],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    if (params.stock !== undefined) {
      await client.query(
        `INSERT INTO inventario_productos (producto_id, cantidad_actual)
         VALUES ($1, $2)
         ON CONFLICT (producto_id) DO UPDATE SET cantidad_actual = EXCLUDED.cantidad_actual`,
        [id, params.stock],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const actualizado = await pool.query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [id]);
  return normalizarProducto(actualizado.rows[0]);
}

/**
 * Producto de Con Sentido para una venta, con su fila de inventario bloqueada
 * (FOR UPDATE) hasta el COMMIT: dos ventas simultáneas del mismo producto no
 * leen el mismo stock.
 */
export async function getProductoParaVenta(client: PoolClient, id: string) {
  const result = await client.query(
    `SELECT p.id, p.nombre, p.sku, p.ecommerce_product_id, p.ecommerce_variant_id,
            COALESCE(ip.cantidad_actual, 0) AS stock
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN inventario_productos ip ON ip.producto_id = p.id
      WHERE p.id = $1 AND m.slug = 'con_sentido'
      FOR UPDATE`,
    [id],
  );
  return result.rowCount ? { ...result.rows[0], stock: Number(result.rows[0].stock) } : null;
}

/**
 * Cuánto se le avisa al e-commerce cuando el stock del POS pasa de `antes` a `despues`. El POS
 * puede quedar en negativo (venta sin stock, con observación) pero el e-commerce nunca baja de 0
 * (decisión del negocio, 2026-10-02): el e-commerce refleja max(stock del POS, 0). Así, p. ej.,
 * vender 1 con stock 0 (0 → -1) no le avisa nada, y un ajuste de -1 a 5 le suma 5, no 6.
 */
export function deltaEcommerce(antes: number, despues: number): number {
  return Math.max(despues, 0) - Math.max(antes, 0);
}

/**
 * Resta stock. Puede quedar en negativo: sin stock se deja vender igual (decisión del negocio),
 * pero entonces la venta exige una observación que explique el descuadre del inventario.
 */
export async function descontarStock(client: PoolClient, productoId: string, cantidad: number) {
  await client.query(
    `INSERT INTO inventario_productos (producto_id, cantidad_actual) VALUES ($1, -$2)
     ON CONFLICT (producto_id) DO UPDATE SET cantidad_actual = cantidad_actual - $2`,
    [productoId, cantidad],
  );
}

/** Devuelve stock al inventario (al anular una venta, ver caja.service.ts::anularVenta). */
export async function reponerStock(client: PoolClient, productoId: string, cantidad: number) {
  await client.query(
    `INSERT INTO inventario_productos (producto_id, cantidad_actual) VALUES ($1, $2)
     ON CONFLICT (producto_id) DO UPDATE SET cantidad_actual = cantidad_actual + $2`,
    [productoId, cantidad],
  );
}

// --------------------------------------------------------------------------
// Clientes (tabla `clientes` compartida entre módulos, ver schema.sql)
// --------------------------------------------------------------------------

export async function listClientes() {
  const result = await pool.query(
    `SELECT id, nombre, telefono, email FROM clientes WHERE activo = true ORDER BY nombre ASC`,
  );
  return result.rows;
}

export async function crearCliente(params: { nombre: string; telefono?: string; email?: string }) {
  const result = await pool.query(
    `INSERT INTO clientes (nombre, telefono, email) VALUES ($1, $2, $3)
     RETURNING id, nombre, telefono, email`,
    [params.nombre, params.telefono || null, params.email || null],
  );
  return result.rows[0];
}

// --------------------------------------------------------------------------
// Ventas
// --------------------------------------------------------------------------

export async function crearVenta(
  executor: Executor,
  params: {
    usuarioId: string | null;
    monto: number;
    metodoPago: "efectivo" | "banco" | "mixto";
    montoEfectivo?: number;
    montoBanco?: number;
  },
) {
  const result = await executor.query(
    `INSERT INTO con_sentido_ventas (usuario_id, monto, metodo_pago, monto_efectivo, monto_banco)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [params.usuarioId, params.monto, params.metodoPago, params.montoEfectivo ?? null, params.montoBanco ?? null],
  );
  return result.rows[0];
}

export async function crearVentaItem(
  executor: Executor,
  params: {
    ventaId: string;
    productoId?: string | null;
    sku?: string | null;
    producto: string;
    descripcion?: string;
    categoria?: string;
    cantidad: number;
    // Obligatoria si la venta dejó el producto en stock negativo.
    observacionInventario?: string | null;
    precioUnitario: number;
  },
) {
  await executor.query(
    `INSERT INTO con_sentido_venta_items (venta_id, producto_id, sku, producto, descripcion, categoria, cantidad, precio_unitario, observacion_inventario)
     VALUES ($1, $7, $8, $2, $3, $4, $5, $6, $9)`,
    [
      params.ventaId,
      params.producto,
      params.descripcion ?? null,
      params.categoria ?? null,
      params.cantidad,
      params.precioUnitario,
      params.productoId ?? null,
      params.sku ?? null,
      params.observacionInventario ?? null,
    ],
  );
}

const SELECT_VENTA_CON_ITEMS = `
  SELECT
    cv.id, cv.created_at, cv.monto, cv.metodo_pago, cv.monto_efectivo, cv.monto_banco,
    MAX(f.numero) AS numero_factura,
    -- GROUP_CONCAT (no JSON_ARRAYAGG) porque es el único agregado de MySQL
    -- que respeta ORDER BY; sin ítems queda NULL y cae en el [] del COALESCE.
    COALESCE(
      CAST(CONCAT('[', GROUP_CONCAT(
        JSON_OBJECT(
          'producto', cvi.producto,
          'sku', cvi.sku,
          'descripcion', cvi.descripcion,
          'categoria', cvi.categoria,
          'cantidad', cvi.cantidad,
          'precio_unitario', cvi.precio_unitario,
          'subtotal', cvi.subtotal
        ) ORDER BY cvi.id SEPARATOR ','
      ), ']') AS JSON),
      JSON_ARRAY()
    ) AS items
  FROM con_sentido_ventas cv
  LEFT JOIN con_sentido_venta_items cvi ON cv.id = cvi.venta_id
  LEFT JOIN facturas f ON f.con_sentido_venta_id = cv.id
`;

export async function listVentas(skip: number, limit: number, fecha?: string) {
  const params: unknown[] = [];
  let where = "";
  if (fecha) {
    params.push(fecha);
    where = `WHERE DATE(cv.created_at) = $${params.length}`;
  }
  params.push(limit, skip);
  const result = await pool.query(
    `${SELECT_VENTA_CON_ITEMS}
     ${where}
     GROUP BY cv.id
     ORDER BY cv.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return result.rows;
}

export async function getVentaById(id: string) {
  const result = await pool.query(`${SELECT_VENTA_CON_ITEMS} WHERE cv.id = $1 GROUP BY cv.id`, [id]);
  return result.rows[0] ?? null;
}

/** Get-or-create idempotente de la factura de una venta — mismo patrón que
 *  migao.repository.ts::getOrCrearFactura, comparte la misma facturas_numero_seq
 *  (un solo número de factura corriendo para todo el negocio). El índice único
 *  en con_sentido_venta_id blinda contra doble clic/pedidos simultáneos. */
export async function getOrCrearFactura(
  params: { ventaId: string; subtotal: number; total: number },
  executor: Executor = pool,
) {
  const insert = await executor.query(
    `INSERT INTO facturas (con_sentido_venta_id, numero, tipo, subtotal, total)
     VALUES ($1, 'F-' || lpad(nextval('facturas_numero_seq'), 6, '0'), 'factura', $2, $3)
     ON CONFLICT (con_sentido_venta_id) WHERE con_sentido_venta_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [params.ventaId, params.subtotal, params.total],
  );
  if (insert.rowCount) return insert.rows[0];

  const existente = await executor.query(`SELECT * FROM facturas WHERE con_sentido_venta_id = $1`, [params.ventaId]);
  return existente.rows[0];
}

/**
 * Ingresos registrados a mano desde Caja General con origen "Con Sentido" (ej.
 * alguien cobró por fuera del flujo de "Nueva venta" y lo registró directo en
 * Caja) — se excluyen los que ya tienen referencia_entidad='con_sentido_ventas'
 * porque esos SÍ vienen de una venta registrada normal y ya aparecen en
 * listVentas; si no se excluyeran, la misma venta se vería duplicada. Mismo
 * patrón que listIngresosManualesMigao en migao.repository.ts.
 */
export async function listIngresosManualesConSentido() {
  const result = await pool.query(
    `SELECT mc.id, mc.monto, mc.motivo, mc.metodo_pago, mc.created_at, u.nombre AS usuario_nombre
       FROM movimientos_caja mc
       JOIN modulos m ON m.id = mc.modulo_origen_id
       LEFT JOIN usuarios u ON u.id = mc.usuario_id
      WHERE m.slug = 'con_sentido' AND mc.tipo = 'ingreso'
        AND NOT (mc.referencia_entidad <=> 'con_sentido_ventas')
      ORDER BY mc.created_at DESC
      LIMIT 200`,
  );
  return result.rows;
}
