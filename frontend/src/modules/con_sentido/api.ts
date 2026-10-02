import { apiFetch } from "../../shared/api/client";
import type { FacturaOrden } from "../migao/api";

export interface ProductoConSentido {
  id: string;
  nombre: string;
  // SKU del e-commerce (null en productos creados a mano en el POS).
  sku: string | null;
  // Viene del e-commerce: nombre, precio y categoría se editan allá.
  sincronizado: boolean;
  // Publicado en la tienda en línea (null si no está sincronizado).
  ecommerce_publicado: boolean | null;
  precio: number;
  descripcion: string | null;
  imagen_url: string | null;
  categoria: string | null;
  stock: number;
  activo: boolean;
}

export interface ClienteConSentido {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
}

export interface ItemVenta {
  // Producto del inventario; sin él es un "Otro producto" (no descuenta stock).
  productoId?: string;
  producto: string;
  descripcion?: string;
  categoria?: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  // Obligatoria si la venta deja el producto en stock negativo.
  observacionInventario?: string;
}

export interface Venta {
  id?: string;
  items: ItemVenta[];
  monto: number;
  metodoPago: "efectivo" | "banco" | "mixto";
  montoEfectivo?: number;
  montoBanco?: number;
  // Últimos 4 del ID de la transferencia (obligatorio si algo va por banco).
  referenciaBanco?: string;
  fecha: string;
}

export const conSentidoApi = {
  registrarVenta: (venta: Venta) =>
    apiFetch<Venta>("/con-sentido/ventas", {
      method: "POST",
      body: venta,
    }),
  listarVentas: (filtros?: { fecha?: string; skip?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (filtros?.fecha) params.set("fecha", filtros.fecha);
    if (filtros?.skip) params.set("skip", String(filtros.skip));
    if (filtros?.limit) params.set("limit", String(filtros.limit));
    const query = params.toString();
    return apiFetch<any[]>(`/con-sentido/ventas${query ? `?${query}` : ""}`);
  },

  // Factura imprimible de una venta ya cobrada — mismo formato normalizado
  // que la factura de Migao (ver con_sentido.service.ts::obtenerFacturaVenta).
  obtenerFactura: (ventaId: string) => apiFetch<FacturaOrden>(`/con-sentido/ventas/${ventaId}/factura`),

  listarProductos: () => apiFetch<ProductoConSentido[]>("/con-sentido/productos"),
  crearProducto: (input: {
    nombre: string;
    precio: number;
    descripcion?: string;
    categoria?: string;
    imagenUrl?: string;
    stock: number;
  }) => apiFetch<ProductoConSentido>("/con-sentido/productos", { method: "POST", body: input }),
  editarProducto: (
    id: string,
    input: Partial<{
      nombre: string;
      precio: number;
      descripcion: string;
      categoria: string;
      imagenUrl: string;
      stock: number;
      activo: boolean;
    }>,
  ) => apiFetch<ProductoConSentido>(`/con-sentido/productos/${id}`, { method: "PATCH", body: input }),

  listarClientes: () => apiFetch<ClienteConSentido[]>("/con-sentido/clientes"),
  crearCliente: (input: { nombre: string; telefono?: string; email?: string }) =>
    apiFetch<ClienteConSentido>("/con-sentido/clientes", { method: "POST", body: input }),
};
