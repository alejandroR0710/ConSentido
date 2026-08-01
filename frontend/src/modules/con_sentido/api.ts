import { apiFetch } from "../../shared/api/client";

export interface ProductoConSentido {
  id: string;
  nombre: string;
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
  producto: string;
  descripcion?: string;
  categoria?: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface Venta {
  id?: string;
  items: ItemVenta[];
  monto: number;
  metodoPago: "efectivo" | "banco" | "mixto";
  montoEfectivo?: number;
  montoBanco?: number;
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
