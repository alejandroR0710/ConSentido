import { apiFetch, apiUpload } from "../../shared/api/client";

export interface OrdenResumen {
  id: string;
  estado: string;
  created_at: string;
  comensal_numero: number;
  numero_personas: number | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  cliente_nombre: string | null;
  mesero_nombre: string | null;
  total: string;
}

export interface OrdenHistorialResumen extends OrdenResumen {
  closed_at: string | null;
}

export interface HistorialEntradaOrden extends OrdenHistorialResumen {
  tipo: "orden";
  movimiento_id: number | null;
  metodo_pago: MetodoPago | null;
}

/** Ingreso registrado a mano desde Caja con origen "Migao (POS)" que no viene de
 *  cerrar una orden (si viniera de ahí, ya aparece como HistorialEntradaOrden). */
export interface HistorialEntradaIngresoManual {
  tipo: "ingreso_manual";
  id: string;
  created_at: string;
  closed_at: string;
  monto: string;
  motivo: string | null;
  metodo_pago: string;
  usuario_nombre: string | null;
}

export type HistorialOrdenEntrada = HistorialEntradaOrden | HistorialEntradaIngresoManual;

export interface OrdenItem {
  id: number;
  producto_id: string;
  producto_nombre: string;
  cantidad: string;
  precio_unitario: string;
  estado: string;
  observaciones: string | null;
  subtotal: number;
}

export interface HistorialEntry {
  id: number;
  orden_item_id: number | null;
  accion: "item_agregado" | "item_editado" | "item_cancelado" | "item_entregado";
  detalle: {
    cantidad?: number;
    precioUnitario?: number;
    cantidadAnterior?: string;
    cantidadNueva?: number;
    estadoAnterior?: string;
  } | null;
  created_at: string;
  usuario_nombre: string | null;
  producto_nombre: string | null;
}

export interface OrdenDetalle {
  orden: {
    id: string;
    estado: string;
    mesa_id: number | null;
    cliente_id: string | null;
    comensal_numero: number;
    numero_personas: number | null;
  };
  items: OrdenItem[];
  total: number;
  historial: HistorialEntry[];
}

export type MetodoPago = "efectivo" | "banco";

// "mixto" no es un método real (ver backend shared/utils/pago-mixto.ts): el
// backend lo descompone en 1-2 pagos/movimientos ya con método puro.
export type PagoInput =
  | { metodoPago: "efectivo" | "banco" }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

// "servido" solo aparece en el historial de despachados (GET /cocina/historial);
// la cola activa (GET /cocina/items) nunca devuelve pendiente/preparando/listo.
export type EstadoItemCocina = "pendiente" | "preparando" | "listo" | "servido";

export interface ItemCocina {
  id: number;
  orden_id: string;
  cantidad: string;
  estado: EstadoItemCocina;
  listo_cocina: boolean;
  created_at: string;
  producto_nombre: string;
  mesa_numero: string | null;
  mesa_piso: number | null;
  mesero_nombre: string | null;
  // Solo la cola activa (GET /cocina/items) los trae — el historial de
  // despachados no los necesita, así que quedan opcionales.
  observaciones?: string | null;
  producto_descripcion?: string | null;
}

export interface ItemActivo extends ItemCocina {
  comensal_numero: number;
}

export interface Producto {
  id: string;
  nombre: string;
  precio: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  descripcion: string | null;
}

export interface ProductoAdmin extends Producto {
  costo: string;
  unidad_medida: string;
  imagen_url: string | null;
  activo: boolean;
}

export interface CategoriaProducto {
  id: number;
  nombre: string;
}

export const migaoApi = {
  listarOrdenesAbiertas: () => apiFetch<OrdenResumen[]>("/migao/ordenes"),
  listarHistorialOrdenes: () => apiFetch<HistorialOrdenEntrada[]>("/migao/ordenes/historial"),
  listarHistorialPropio: () => apiFetch<OrdenHistorialResumen[]>("/migao/ordenes/historial-propio"),
  obtenerDetalle: (ordenId: string) => apiFetch<OrdenDetalle>(`/migao/ordenes/${ordenId}`),
  cerrarOrden: (ordenId: string, pago: PagoInput) =>
    apiFetch<{ orden: unknown; venta: unknown; total: number }>(`/migao/ordenes/${ordenId}/cerrar`, {
      method: "POST",
      body: { dividir: false, ...pago },
    }),
  // Cuenta dividida: cada parte trae su propio método de pago (simple o mixto)
  // y los ids de los productos que le corresponden (todos los productos de la
  // orden deben quedar asignados a alguna parte, el backend lo valida).
  cerrarOrdenDividida: (ordenId: string, partes: (PagoInput & { itemIds: number[] })[]) =>
    apiFetch<{ orden: unknown; venta: unknown; total: number }>(`/migao/ordenes/${ordenId}/cerrar`, {
      method: "POST",
      body: { dividir: true, partes },
    }),
  cancelarOrden: (ordenId: string) =>
    apiFetch<{ id: string; estado: string }>(`/migao/ordenes/${ordenId}/cancelar`, { method: "POST" }),
  resetearOrdenes: () =>
    apiFetch<{ ordenesBorradas: number; ventasBorradas: number; pagosBorrados: number; movimientosCajaBorrados: number }>(
      "/migao/ordenes/reset",
      { method: "POST", body: { confirmacion: "REINICIAR ORDENES" } },
    ),
  listarColaCocina: () => apiFetch<ItemCocina[]>("/migao/cocina/items"),
  listarHistorialDespachados: () => apiFetch<ItemCocina[]>("/migao/cocina/historial"),
  empezarPreparar: (ordenId: string) =>
    apiFetch<ItemCocina[]>(`/migao/ordenes/${ordenId}/empezar-preparar`, { method: "POST" }),
  marcarCheckItem: (itemId: number, listoCocina: boolean) =>
    apiFetch<ItemCocina>(`/migao/items/${itemId}/check`, { method: "PATCH", body: { listoCocina } }),
  marcarOrdenLista: (ordenId: string) =>
    apiFetch<ItemCocina[]>(`/migao/ordenes/${ordenId}/marcar-listo`, { method: "POST" }),

  listarProductos: () => apiFetch<Producto[]>("/migao/productos"),
  crearProducto: (input: {
    nombre: string;
    precio: number;
    costo?: number;
    unidadMedida?: string;
    categoriaId?: number;
    descripcion?: string;
  }) => apiFetch<Producto>("/migao/productos", { method: "POST", body: input }),
  listarProductosAdmin: () => apiFetch<ProductoAdmin[]>("/migao/productos/admin"),
  editarProducto: (
    id: string,
    input: {
      nombre?: string;
      precio?: number;
      costo?: number;
      unidadMedida?: string;
      categoriaId?: number;
      descripcion?: string;
      activo?: boolean;
    },
  ) => apiFetch<ProductoAdmin>(`/migao/productos/${id}`, { method: "PATCH", body: input }),
  subirImagenProducto: (id: string, file: File) => apiUpload<ProductoAdmin>(`/migao/productos/${id}/imagen`, file),
  listarCategorias: () => apiFetch<CategoriaProducto[]>("/migao/categorias"),
  crearCategoria: (nombre: string) =>
    apiFetch<CategoriaProducto>("/migao/categorias", { method: "POST", body: { nombre } }),
  listarItemsActivos: () => apiFetch<ItemActivo[]>("/migao/items/activos"),
  crearOrden: (
    mesaNumero: string,
    items: { productoId: string; cantidad: number; precioUnitario: number; observaciones?: string }[],
    numeroPersonas?: number,
    piso?: number,
  ) =>
    apiFetch<{ id: string; comensal_numero: number }>("/migao/ordenes", {
      method: "POST",
      body: { mesaNumero, items, numeroPersonas, piso },
    }),
  agregarItem: (
    ordenId: string,
    productoId: string,
    cantidad: number,
    precioUnitario: number,
    observaciones?: string,
  ) =>
    apiFetch<OrdenItem>(`/migao/ordenes/${ordenId}/items`, {
      method: "POST",
      body: { productoId, cantidad, precioUnitario, observaciones },
    }),
  editarCantidadItem: (itemId: number, cantidad: number) =>
    apiFetch<OrdenItem>(`/migao/items/${itemId}`, { method: "PATCH", body: { cantidad } }),
  cancelarItem: (itemId: number) =>
    apiFetch<OrdenItem>(`/migao/items/${itemId}`, { method: "PATCH", body: { cancelar: true } }),
  entregarItem: (itemId: number) =>
    apiFetch<OrdenItem>(`/migao/items/${itemId}/entregar`, { method: "PATCH" }),
};
