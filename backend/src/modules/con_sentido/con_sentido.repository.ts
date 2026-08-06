import { Pool, PoolClient } from "pg";
import { pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

// --------------------------------------------------------------------------
// Productos (tabla `productos` compartida con Migao, distinguida por
// modulo_id) + `inventario_productos` para el stock de producto terminado.
// --------------------------------------------------------------------------

export async function listProductos() {
  const result = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.descripcion, p.imagen_url, p.activo,
            cp.nombre AS categoria, COALESCE(ip.cantidad_actual, 0) AS stock
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
       LEFT JOIN inventario_productos ip ON ip.producto_id = p.id
      WHERE m.slug = 'con_sentido' AND p.activo = true
      ORDER BY p.nombre ASC`,
  );
  return result.rows;
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
    `SELECT p.id, p.categoria_id
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

  const actualizado = await pool.query(
    `SELECT p.id, p.nombre, p.precio, p.descripcion, p.imagen_url, p.activo,
            cp.nombre AS categoria, COALESCE(ip.cantidad_actual, 0) AS stock
       FROM productos p
       LEFT JOIN categorias_producto cp ON cp.id = p.categoria_id
       LEFT JOIN inventario_productos ip ON ip.producto_id = p.id
      WHERE p.id = $1`,
    [id],
  );
  return actualizado.rows[0];
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
    producto: string;
    descripcion?: string;
    categoria?: string;
    cantidad: number;
    precioUnitario: number;
  },
) {
  await executor.query(
    `INSERT INTO con_sentido_venta_items (venta_id, producto, descripcion, categoria, cantidad, precio_unitario)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.ventaId,
      params.producto,
      params.descripcion ?? null,
      params.categoria ?? null,
      params.cantidad,
      params.precioUnitario,
    ],
  );
}

const SELECT_VENTA_CON_ITEMS = `
  SELECT
    cv.id, cv.created_at, cv.monto, cv.metodo_pago, cv.monto_efectivo, cv.monto_banco,
    COALESCE(
      json_agg(
        json_build_object(
          'producto', cvi.producto,
          'descripcion', cvi.descripcion,
          'categoria', cvi.categoria,
          'cantidad', cvi.cantidad,
          'precio_unitario', cvi.precio_unitario,
          'subtotal', cvi.subtotal
        ) ORDER BY cvi.id
      ) FILTER (WHERE cvi.id IS NOT NULL),
      '[]'::json
    ) AS items
  FROM con_sentido_ventas cv
  LEFT JOIN con_sentido_venta_items cvi ON cv.id = cvi.venta_id
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
export async function getOrCrearFactura(params: { ventaId: string; subtotal: number; total: number }) {
  const insert = await pool.query(
    `INSERT INTO facturas (con_sentido_venta_id, numero, tipo, subtotal, total)
     VALUES ($1, 'F-' || lpad(nextval('facturas_numero_seq')::text, 6, '0'), 'factura', $2, $3)
     ON CONFLICT (con_sentido_venta_id) WHERE con_sentido_venta_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [params.ventaId, params.subtotal, params.total],
  );
  if (insert.rowCount) return insert.rows[0];

  const existente = await pool.query(`SELECT * FROM facturas WHERE con_sentido_venta_id = $1`, [params.ventaId]);
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
        AND mc.referencia_entidad IS DISTINCT FROM 'con_sentido_ventas'
      ORDER BY mc.created_at DESC
      LIMIT 200`,
  );
  return result.rows;
}
