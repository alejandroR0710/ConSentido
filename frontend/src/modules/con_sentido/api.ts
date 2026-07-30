import { apiFetch } from "../../shared/api/client";

export interface Producto {
  id: number;
  nombre: string;
  precio: number;
  descripcion?: string;
  imagen?: string;
  categoria?: string;
  stock: number;
  sku: string;
}

export interface ItemVenta {
  producto: string;
  descripcion?: string;
  imagen?: string;
  categoria?: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface Venta {
  id?: number;
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
  listarVentas: (filtros?: { fecha?: string; skip?: number; limit?: number }) =>
    apiFetch<Venta[]>("/con-sentido/ventas", {
      method: "GET",
      ...(filtros && { body: filtros }),
    }),
  listarVentasPorFecha: (fecha: string) =>
    apiFetch<Venta[]>(`/con-sentido/ventas?fecha=${fecha}`),
};
