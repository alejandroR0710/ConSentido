import { PoolClient, pool } from "../../shared/db/pool";
import { claveItem, type DeltaStockEcommerce, type EventoEntrante, type ItemEcommerce, type SnapshotProducto } from "./tipos";

export type ResultadoRecepcion =
  | { status: "APPLIED" }
  | { status: "IGNORED"; detail: string }
  | { status: "DUPLICATE" };

/**
 * Aplica un aviso del e-commerce. Idempotente por `eventId`
 * (ecommerce_sync_recibidos, en la misma transacción): si el e-commerce
 * reintenta uno ya aplicado, no se aplica dos veces. Lo que no se puede aplicar
 * (ítem desconocido) se marca IGNORED y se responde OK igual — reintentarlo no
 * lo arreglaría y bloquearía los avisos siguientes.
 */
export async function aplicarEvento(evento: EventoEntrante): Promise<ResultadoRecepcion> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ya = await client.query(`SELECT 1 FROM ecommerce_sync_recibidos WHERE event_id = $1 FOR UPDATE`, [
      evento.eventId,
    ]);
    if (ya.rowCount) {
      await client.query("ROLLBACK");
      return { status: "DUPLICATE" };
    }

    const resultado =
      evento.type === "PRODUCT_SNAPSHOT"
        ? await aplicarSnapshot(client, evento.payload)
        : await aplicarDelta(client, evento.payload);

    await client.query(
      `INSERT INTO ecommerce_sync_recibidos (event_id, tipo, resultado, detalle) VALUES ($1, $2, $3, $4)`,
      [evento.eventId, evento.type, resultado.status, resultado.status === "IGNORED" ? resultado.detail : null],
    );
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    // Dos entregas simultáneas del mismo aviso: la otra ya lo registró.
    if ((err as { code?: string }).code === "23505") return { status: "DUPLICATE" };
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Catálogo: crea/actualiza los ítems del producto y desactiva los que ya no
// existen en el e-commerce (variante borrada, producto eliminado).
// ---------------------------------------------------------------------------

async function aplicarSnapshot(client: PoolClient, snap: SnapshotProducto): Promise<ResultadoRecepcion> {
  const categoriaId = await obtenerOCrearCategoria(client, snap.category);
  const claves: string[] = [];

  for (const item of snap.items) {
    const clave = claveItem(item.productId, item.variantId);
    claves.push(clave);
    const nombre = item.name.slice(0, 150);

    const existente = await client.query(`SELECT id FROM productos WHERE ecommerce_item_key = $1`, [clave]);
    if (existente.rowCount) {
      const id = existente.rows[0].id as string;
      await client.query(
        `UPDATE productos
            SET nombre = $2, sku = $3, precio = $4, categoria_id = $5, imagen_url = $6,
                ecommerce_publicado = $7, activo = true,
                precio_mayorista = $8, mayorista_desde = $9, nota_mayorista = $10
          WHERE id = $1`,
        [id, nombre, item.sku, item.price, categoriaId, snap.imageUrl, snap.published, ...mayorista(item)],
      );
      // El stock de un ítem que ya existe solo lo mueven los STOCK_DELTA, salvo
      // en la carga inicial / resincronización.
      if (snap.setStock) await fijarStock(client, id, item.stock);
    } else {
      const creado = await client.query(
        `INSERT INTO productos
           (nombre, sku, ecommerce_item_key, ecommerce_product_id, ecommerce_variant_id, ecommerce_publicado,
            modulo_id, categoria_id, precio, imagen_url, activo, precio_mayorista, mayorista_desde, nota_mayorista)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM modulos WHERE slug = 'con_sentido'), $7, $8, $9, true,
                 $10, $11, $12)
         RETURNING id`,
        [nombre, item.sku, clave, item.productId, item.variantId, snap.published, categoriaId, item.price, snap.imageUrl,
          ...mayorista(item)],
      );
      await fijarStock(client, creado.rows[0].id, item.stock);
    }
  }

  await client.query(
    `UPDATE productos SET activo = false
      WHERE ecommerce_product_id = $1
        AND ${claves.length ? "ecommerce_item_key NOT IN ($2)" : "1 = 1"}`,
    claves.length ? [snap.productId, claves] : [snap.productId],
  );
  return { status: "APPLIED" };
}

/** [precio_mayorista, mayorista_desde, nota_mayorista] del ítem; sin mayorista, los tres null. */
function mayorista(item: ItemEcommerce): [number | null, number | null, string | null] {
  if (item.wholesalePrice == null || item.wholesaleMinQty == null) return [null, null, null];
  return [item.wholesalePrice, item.wholesaleMinQty, item.wholesaleNote?.slice(0, 120) ?? null];
}

async function fijarStock(client: PoolClient, productoId: string, cantidad: number) {
  await client.query(
    `INSERT INTO inventario_productos (producto_id, cantidad_actual) VALUES ($1, $2)
     ON CONFLICT (producto_id) DO UPDATE SET cantidad_actual = EXCLUDED.cantidad_actual`,
    [productoId, Math.max(0, cantidad)],
  );
}

async function obtenerOCrearCategoria(client: PoolClient, nombre: string | null): Promise<number | null> {
  const limpio = nombre?.trim().slice(0, 80);
  if (!limpio) return null;
  const existente = await client.query(`SELECT id FROM categorias_producto WHERE nombre = $1`, [limpio]);
  if (existente.rowCount) return existente.rows[0].id;
  const creada = await client.query(
    `INSERT INTO categorias_producto (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [limpio],
  );
  return creada.rows[0].id;
}

// ---------------------------------------------------------------------------
// Stock: venta en línea, cancelación o ajuste hecho en el e-commerce.
// ---------------------------------------------------------------------------

async function aplicarDelta(client: PoolClient, delta: DeltaStockEcommerce): Promise<ResultadoRecepcion> {
  let producto = await client.query(`SELECT id FROM productos WHERE ecommerce_item_key = $1`, [
    claveItem(delta.productId, delta.variantId),
  ]);
  if (!producto.rowCount && delta.sku) {
    producto = await client.query(
      `SELECT id FROM productos WHERE sku = $1 AND ecommerce_item_key IS NOT NULL ORDER BY activo DESC LIMIT 1`,
      [delta.sku],
    );
  }
  if (!producto.rowCount) {
    // Todavía no llegó su ficha (p. ej. antes de la carga inicial): la carga
    // inicial trae el stock correcto.
    return { status: "IGNORED", detail: `SKU "${delta.sku}" no existe en el POS.` };
  }

  const productoId = producto.rows[0].id as string;
  await client.query(
    `INSERT INTO inventario_productos (producto_id, cantidad_actual) VALUES ($1, $2)
     ON CONFLICT (producto_id) DO UPDATE SET cantidad_actual = GREATEST(0, cantidad_actual + $3)`,
    [productoId, Math.max(0, delta.delta), delta.delta],
  );
  return { status: "APPLIED" };
}
