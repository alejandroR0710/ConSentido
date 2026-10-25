import { Pool, PoolClient, pool } from "../../shared/db/pool";
import { encolarDeltaStock } from "../integracion_ecommerce/salida";

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
    `SELECT p.id, p.nombre, p.sku, p.ecommerce_product_id, p.ecommerce_variant_id, p.precio,
            COALESCE(ip.cantidad_actual, 0) AS stock
       FROM productos p
       JOIN modulos m ON m.id = p.modulo_id
       LEFT JOIN inventario_productos ip ON ip.producto_id = p.id
      WHERE p.id = $1 AND m.slug = 'con_sentido'
      FOR UPDATE`,
    [id],
  );
  if (!result.rowCount) return null;
  return { ...result.rows[0], stock: Number(result.rows[0].stock), precio: Number(result.rows[0].precio) };
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
    cv.id, cv.created_at, cv.monto, cv.metodo_pago, cv.monto_efectivo, cv.monto_banco, cv.estado,
    cv.parte_id, cv.descuento_porcentaje, cv.descuento,
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
  // Los carritos vinculados a una mesa que todavía no se terminan de pagar
  // (estado='pendiente') no son ventas reales todavía — no deben aparecer
  // en el historial normal de Con Sentido (hallazgo I6 de la revisión
  // final). Las anuladas sí se siguen mostrando, igual que antes.
  let where = "WHERE cv.estado != 'pendiente'";
  if (fecha) {
    params.push(fecha);
    where += ` AND DATE(cv.created_at) = $${params.length}`;
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

// --------------------------------------------------------------------------
// Carrito de tienda vinculado a una parte de cuenta dividida de Migao — ver
// docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
// Estas funciones NO tocan stock/inventario (eso vive en con_sentido.service.ts,
// que ya importa descontarParaVenta de ./stock-venta.ts — ese archivo a su
// vez importa de ESTE, así que acá nunca se importa stock-venta.ts, o
// quedaría un ciclo entre los dos).
// --------------------------------------------------------------------------

export type CarritoTienda = {
  ventaId: string;
  estado: "pendiente" | "completada";
  items: { productoId: string | null; nombre: string; cantidad: number; precioUnitario: number; subtotal: number }[];
  descuentoPorcentaje: number;
  descuentoMonto: number;
  monto: number;
  pagado: number;
  pagoAdministrativo: boolean;
  pendiente: number;
};

export async function getCarritoTiendaPorParte(parteId: string, executor: Executor = pool): Promise<CarritoTienda | null> {
  const ventaResult = await executor.query(
    `SELECT id, estado, monto, descuento_porcentaje, descuento, pago_administrativo
       FROM con_sentido_ventas WHERE parte_id = $1 AND estado != 'anulada'`,
    [parteId],
  );
  if (!ventaResult.rowCount) return null;
  const venta = ventaResult.rows[0];

  const itemsResult = await executor.query(
    `SELECT producto_id, producto, cantidad, precio_unitario, subtotal
       FROM con_sentido_venta_items WHERE venta_id = $1 ORDER BY id ASC`,
    [venta.id],
  );
  const pagadoResult = await executor.query(
    `SELECT COALESCE(SUM(monto), 0) AS pagado FROM movimientos_caja
      WHERE referencia_entidad = 'con_sentido_ventas' AND referencia_id = $1`,
    [venta.id],
  );

  const monto = Number(venta.monto);
  const pagado = Number(pagadoResult.rows[0].pagado);
  return {
    ventaId: venta.id as string,
    estado: venta.estado as "pendiente" | "completada",
    items: itemsResult.rows.map((i) => ({
      productoId: i.producto_id as string | null,
      nombre: i.producto as string,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    descuentoPorcentaje: Number(venta.descuento_porcentaje ?? 0),
    descuentoMonto: Number(venta.descuento ?? 0),
    monto,
    pagado,
    // Cerrado con pago administrativo: saldado aunque no haya entrado a Caja.
    pagoAdministrativo: Number(venta.pago_administrativo ?? 0) === 1,
    pendiente: Number(venta.pago_administrativo ?? 0) === 1 ? 0 : Math.max(0, monto - pagado),
  };
}

export async function crearCarritoTienda(client: PoolClient, parteId: string, usuarioId: string) {
  const result = await client.query(
    `INSERT INTO con_sentido_ventas (usuario_id, monto, metodo_pago, estado, parte_id, descuento_porcentaje, descuento)
     VALUES ($1, 0, NULL, 'pendiente', $2, 0, 0) RETURNING id`,
    [usuarioId, parteId],
  );
  return result.rows[0] as { id: string };
}

/** Ítems actuales del carrito, solo para que el llamador sepa a quién
 *  devolverle stock antes de reemplazarlos — ver con_sentido.service.ts::vincularCarritoTienda. */
export async function getItemsCarrito(ventaId: string, executor: Executor = pool) {
  const result = await executor.query(
    `SELECT producto_id, cantidad FROM con_sentido_venta_items WHERE venta_id = $1`,
    [ventaId],
  );
  return result.rows as { producto_id: string | null; cantidad: string }[];
}

/** Reemplaza TODOS los ítems del carrito y recalcula monto/descuento — el
 *  llamador ya resolvió nombre/sku/estado de inventario de cada ítem (ver
 *  descontarParaVenta en con_sentido.service.ts), esta función solo escribe. */
export async function reemplazarItemsCarrito(
  client: PoolClient,
  params: {
    ventaId: string;
    items: {
      // null = línea de texto libre (sin producto real del catálogo), sin
      // control de inventario ni sincronía con la tienda en línea — ver
      // con_sentido.service.ts::vincularCarritoTienda.
      productoId: string | null;
      sku: string | null;
      nombre: string;
      cantidad: number;
      precioUnitario: number;
      observacionInventario: string | null;
    }[];
    descuentoPorcentaje: number;
  },
) {
  await client.query(`DELETE FROM con_sentido_venta_items WHERE venta_id = $1`, [params.ventaId]);

  let subtotal = 0;
  for (const item of params.items) {
    await crearVentaItem(client, {
      ventaId: params.ventaId,
      productoId: item.productoId,
      sku: item.sku,
      producto: item.nombre,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      observacionInventario: item.observacionInventario,
    });
    subtotal += item.cantidad * item.precioUnitario;
  }

  // A peso entero (no a centavo) — mismo criterio que el resto de los
  // cálculos de pago/descuento de este negocio (ver migao.service.ts). Un
  // descuento con centavos sueltos fue la causa raíz del hallazgo C3 de la
  // revisión final (el carrito de tienda quedaba eternamente corto por
  // unos centavos y nunca se marcaba "completada").
  const descuentoMonto = Math.round(subtotal * (params.descuentoPorcentaje / 100));
  const monto = subtotal - descuentoMonto;
  await client.query(
    `UPDATE con_sentido_ventas SET monto = $2, descuento_porcentaje = $3, descuento = $4 WHERE id = $1`,
    [params.ventaId, monto, params.descuentoPorcentaje, descuentoMonto],
  );
  return { subtotal, descuentoMonto, monto };
}

/** Borra del todo el carrito de tienda de una parte — con_sentido_venta_items
 *  cae en cascada (ON DELETE CASCADE). El llamador ya devolvió el stock y
 *  avisó al e-commerce antes de llamar esto (ver con_sentido.service.ts::quitarCarritoTienda). */
export async function eliminarCarritoTienda(client: PoolClient, ventaId: string) {
  await client.query(`DELETE FROM con_sentido_ventas WHERE id = $1`, [ventaId]);
}

export async function marcarCarritoCompletado(
  client: PoolClient,
  ventaId: string,
  pago: { metodoPago: "efectivo" | "banco" | "mixto"; montoEfectivo: number; montoBanco: number },
) {
  await client.query(
    `UPDATE con_sentido_ventas SET estado = 'completada', metodo_pago = $2, monto_efectivo = $3, monto_banco = $4 WHERE id = $1`,
    [ventaId, pago.metodoPago, pago.montoEfectivo, pago.montoBanco],
  );
}

/** Cierre administrativo del carrito de tienda de una mesa (ver
 *  migao.service.ts::cerrarCobroAdministrativo): queda completada, sin método de
 *  pago real (no entró nada a Caja) y marcada para que ya no figure pendiente. */
export async function marcarCarritoAdministrativo(client: PoolClient, ventaId: string) {
  await client.query(
    `UPDATE con_sentido_ventas SET estado = 'completada', pago_administrativo = 1 WHERE id = $1`,
    [ventaId],
  );
}

/** Anula los carritos de tienda que quedaron pendientes (sin pagar nada) de
 *  una orden al cancelarla — devuelve el stock de cada ítem. Nunca toca uno
 *  que ya esté 'completada' (ver existenPagosTiendaPorOrden, que bloquea la
 *  cancelación completa si ya se pagó algo). */
/** @returns true si quedó algo por avisarle al e-commerce — el llamador debe
 *  llamar a `programarEnvio()` (fuera de esta transacción) si devuelve true. */
export async function anularCarritosTiendaPorOrden(client: PoolClient, ordenId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT cv.id FROM con_sentido_ventas cv
       JOIN migao_cuenta_partes cp ON cp.id = cv.parte_id
       JOIN ventas v ON v.id = cp.venta_id
      WHERE v.orden_id = $1 AND cv.estado = 'pendiente'`,
    [ordenId],
  );
  let huboAvisosEcommerce = false;
  for (const row of result.rows) {
    const items = await client.query(
      `SELECT producto_id, cantidad FROM con_sentido_venta_items WHERE venta_id = $1`,
      [row.id],
    );
    for (const item of items.rows) {
      if (!item.producto_id) continue;
      const producto = await getProductoParaVenta(client, item.producto_id);
      if (!producto) continue; // ya no está en el catálogo
      await reponerStock(client, producto.id, Number(item.cantidad));
      // Mismo criterio que caja.service.ts::anularVenta — el e-commerce
      // refleja max(stock, 0), así que una devolución solo le avisa lo que
      // de verdad vuelve a quedar por encima de 0 (hallazgo I8 de la
      // revisión final).
      const delta = deltaEcommerce(producto.stock, producto.stock + Number(item.cantidad));
      if (producto.ecommerce_product_id && delta !== 0) {
        await encolarDeltaStock(client, {
          productId: producto.ecommerce_product_id,
          variantId: producto.ecommerce_variant_id ?? null,
          sku: producto.sku,
          delta,
          kind: "RETURN",
          reason: "Cancelación de mesa con carrito de tienda vinculado",
        });
        huboAvisosEcommerce = true;
      }
    }
    await client.query(`UPDATE con_sentido_ventas SET estado = 'anulada' WHERE id = $1`, [row.id]);
  }
  return huboAvisosEcommerce;
}

/** Si ya se cobró algo (cualquier abono) del carrito de tienda de alguna
 *  parte de esta orden — usado por migao.service.ts::cancelarOrden, mismo
 *  criterio que existenPagosPorOrden del lado de mesa. */
export async function existenPagosTiendaPorOrden(ordenId: string) {
  const result = await pool.query(
    `SELECT 1 FROM movimientos_caja mc
       JOIN con_sentido_ventas cv ON cv.id = mc.referencia_id
       JOIN migao_cuenta_partes cp ON cp.id = cv.parte_id
       JOIN ventas v ON v.id = cp.venta_id
      WHERE mc.referencia_entidad = 'con_sentido_ventas' AND v.orden_id = $1 LIMIT 1`,
    [ordenId],
  );
  return result.rowCount! > 0;
}
