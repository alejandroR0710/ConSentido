import { PoolClient } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import { deltaEcommerce, descontarStock, getProductoParaVenta } from "./con_sentido.repository";

/**
 * Descuenta del inventario un producto vendido — usado por "Nueva venta" de Con Sentido y por
 * "Registrar ingreso" de Caja General. Sin stock suficiente se vende igual y el stock queda en
 * negativo, pero entonces quien vende debe dejar una observación que explique el descuadre
 * (apareció en bodega, se hizo para esta venta, mala contada...). Devuelve null si el producto
 * ya no está en el catálogo (cada llamador decide si eso bloquea la venta).
 */
export async function descontarParaVenta(
  client: PoolClient,
  params: { productoId: string; cantidad: number; nombre: string; observacion?: string | null },
) {
  const producto = await getProductoParaVenta(client, params.productoId);
  if (!producto) return null;

  const stockDespues = producto.stock - params.cantidad;
  const observacion = params.observacion?.trim() || null;
  if (stockDespues < 0 && !observacion) {
    throw Errors.badRequest(
      `"${params.nombre}" queda con stock ${stockDespues}: escribe una observación explicando por qué no cuadra el inventario.`,
    );
  }
  await descontarStock(client, producto.id, params.cantidad);

  return {
    producto,
    // Solo se guarda cuando de verdad quedó en negativo.
    observacion: stockDespues < 0 ? observacion : null,
    // Lo que se le avisa al e-commerce (que nunca baja de 0); 0 = nada que avisar.
    deltaEcommerce: deltaEcommerce(producto.stock, stockDespues),
  };
}

/** Motivo del movimiento en el e-commerce: la venta y, si quedó en negativo, la observación. */
export function motivoVenta(base: string, observacion: string | null): string {
  return observacion ? `${base} — Sin stock: ${observacion}` : base;
}
