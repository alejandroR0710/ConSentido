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
  // Precio mayorista neto desde `mayorista_desde` unidades (sumando las variantes del mismo
  // producto del e-commerce: `grupo`); llega del e-commerce. null = sin mayorista.
  precio_mayorista: number | null;
  mayorista_desde: number | null;
  nota_mayorista: string | null;
  grupo: string;
  descripcion: string | null;
  imagen_url: string | null;
  categoria: string | null;
  // Todas las categorías del producto (puede estar en varias, sincronizado
  // del e-commerce), separadas por ", "; null si no tiene ninguna. Incluye
  // siempre lo que haya en `categoria`. Ver con_sentido.repository.ts::SELECT_PRODUCTO.
  categorias: string | null;
  stock: number;
  activo: boolean;
  // Área económica a la que pertenece por defecto, según el módulo
  // (Insumos u otro) de su categoría — ver categorias_producto.modulo_id.
  // Sirve para precargar el selector de área al vender/registrar un ingreso.
  areaDefecto: "insumos" | "con_sentido";
}

export interface ClienteConSentido {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
}

// Categoría de producto de Con Sentido con su área (módulo) por defecto —
// ver con_sentido.repository.ts::listarCategoriasConArea. A diferencia de
// CategoriaGasto (caja), aquí solo existen dos áreas posibles.
export interface CategoriaConSentido {
  id: number;
  nombre: string;
  areaSlug: "insumos" | "con_sentido";
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
  // De qué área es este ítem — obligatorio (no opcional): a diferencia de
  // Caja General, "Nueva venta" de Con Sentido no tiene modo "monto único"
  // sin productos, así que SIEMPRE hay un área que declarar (ver
  // itemVentaSchema en el backend, Task 8).
  moduloOrigenSlug: "insumos" | "con_sentido";
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
  // Puerta 2 de la venta combinada mesa + Con Sentido — vincula este carrito
  // a una mesa de Migao en vez de registrarlo como venta suelta. Con
  // productoId es un producto real del catálogo (descuenta stock, sincroniza
  // con la tienda en línea); sin productoId es texto libre — sin esos
  // controles, el precio queda tal cual lo escribe el cajero — ver
  // docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
  vincularMesa: (input: {
    ordenId: string;
    parteId?: string;
    items: {
      productoId?: string;
      nombre?: string;
      cantidad: number;
      precioUnitario: number;
      observacionInventario?: string;
    }[];
    descuentoPorcentaje?: number;
  }) =>
    apiFetch<{ ventaId: string; parteId: string; subtotal: number; descuentoMonto: number; monto: number }>(
      "/con-sentido/vincular-mesa",
      { method: "POST", body: input },
    ),
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

  // Administración del área por defecto de las categorías de producto —
  // ver con_sentido.routes.ts (gateado por con_sentido.categorias.administrar).
  listarCategorias: () => apiFetch<CategoriaConSentido[]>("/con-sentido/categorias"),
  actualizarAreaCategoria: (id: number, areaSlug: "insumos" | "con_sentido") =>
    apiFetch<{ id: number; nombre: string }>(`/con-sentido/categorias/${id}`, {
      method: "PATCH",
      body: { areaSlug },
    }),
};
