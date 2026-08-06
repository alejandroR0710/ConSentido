import { apiFetch, apiUpload } from "../../shared/api/client";

export interface OrdenResumen {
  id: string;
  estado: string;
  created_at: string;
  comensal_numero: number;
  numero_personas: number | null;
  mesa_id: number | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  cliente_nombre: string | null;
  mesero_nombre: string | null;
  total: string;
}

/** Mesa del plano visual — ubicación/tamaño en % (0-100) del lienzo de su
 *  área (piso). `pos_x`/`pos_y`/`ancho`/`alto` son null si todavía no se
 *  "dibujó" en el editor (creada solo por número, como antes). Postgres
 *  NUMERIC vuelve como texto (igual que `precio` en Producto) — hay que
 *  parsearlo con Number(...) antes de usarlo en cualquier cuenta. */
export interface Mesa {
  id: number;
  zona_id: number | null;
  numero: string;
  piso: number;
  capacidad: number;
  estado: string;
  pos_x: string | null;
  pos_y: string | null;
  ancho: string | null;
  alto: string | null;
  activo: boolean;
}

export interface OrdenHistorialResumen extends OrdenResumen {
  closed_at: string | null;
  // `total` (heredado de OrdenResumen) es el subtotal SIN descuento; si hubo
  // descuento, `total_cobrado` es lo que realmente se cobró.
  descuento_porcentaje: number;
  total_cobrado: string;
}

export interface HistorialEntradaOrden extends OrdenHistorialResumen {
  tipo: "orden";
  movimiento_id: number | null;
  metodo_pago: MetodoPago | null;
}

/** Cuenta cerrada con pago "administrativo": no generó ingreso en Caja
 *  General, vive en su propio historial (ver HistorialAdministrativoPage). */
export interface HistorialAdministrativoEntrada {
  id: string;
  estado: string;
  created_at: string;
  closed_at: string | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  mesero_nombre: string | null;
  referencia: string | null;
  total: string;
  descuento_porcentaje: number;
  total_cobrado: string;
}

/** Cuánto entró de Migao ese día en efectivo/banco, tomado de Caja General —
 *  se usa para agrupar el historial de órdenes por día con su subtotal. */
export interface ResumenDiarioIngreso {
  fecha: string;
  efectivo: number;
  banco: number;
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
  es_para_llevar: boolean;
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
// "administrativo": exclusivo de Root/Super Root, no genera ingreso en Caja
// General (ver migao.service.ts::cerrarOrden) y solo aplica al cobro simple.
export type PagoInput =
  | { metodoPago: "efectivo" | "banco" | "administrativo" }
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
  es_para_llevar: boolean;
  // Calculados en vivo contra la receta de inventario del producto (ver
  // migao.repository.ts::listProductosMigao) — un producto sin receta nunca
  // sale marcado, no depende de inventario.
  sin_stock: boolean;
  bajo_stock: boolean;
}

export interface ProductoAdmin extends Producto {
  costo: string;
  unidad_medida: string;
  imagen_url: string | null;
  activo: boolean;
  // Receta de inventario que consume — [] si no tiene ninguna asociada.
  ingredientes: { nombre: string; cantidadPorUnidad: string; unidadMedida: string }[];
}

export interface CategoriaProducto {
  id: number;
  nombre: string;
}

export interface InventarioProducto {
  id: string;
  nombre: string;
  unidad_medida: string;
  unidades_por_paquete: string;
  tamano_unidad: string | null;
  costo_paquete: string | null;
  stock_unidades: string;
  stock_minimo_unidades: string | null;
  activo: boolean;
  created_at: string;
}

export interface InventarioMovimiento {
  id: number;
  producto_id: string;
  tipo: "entrada" | "ajuste" | "consumo";
  cantidad_unidades: string;
  motivo: string | null;
  referencia_entidad: string | null;
  referencia_id: string | null;
  usuario_id: string;
  usuario_nombre: string | null;
  created_at: string;
}

export interface IngredienteProducto {
  id: number;
  productoId: string;
  inventarioProductoId: string;
  cantidadPorUnidad: string;
  nombre: string;
  unidadMedida: string;
}

/** Propina opcional al cobrar — dinero del mesero/personal, nunca cuenta
 *  para Caja General. `porcentaje` null = valor voluntario/personalizado.
 *  `liquidada_en` null = todavía pendiente por repartir. */
export interface PropinaEntrada {
  id: string;
  orden_id: string;
  venta_id: string;
  monto: string;
  porcentaje: string | null;
  metodo_pago: "efectivo" | "banco";
  liquidada_en: string | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  mesero_nombre: string | null;
  created_at: string;
}

/** Propina opcional (5%/10%/valor voluntario), calculada una sola vez sobre
 *  el valor de la cuenta — nunca entra a la validación de mixto ni a Caja
 *  General (ver migao.service.ts::cerrarOrden). */
export interface PropinaInput {
  propina?: number;
  propinaPorcentaje?: number | null;
  propinaMetodoPago?: "efectivo" | "banco";
}

/** Reparto (liquidación) de las propinas pendientes de UN método — efectivo
 *  y banco se reparten por separado. */
export interface LiquidacionPropinas {
  id: string;
  metodo_pago: "efectivo" | "banco";
  monto: string;
  nota: string | null;
  created_at: string;
}

export const migaoApi = {
  listarOrdenesAbiertas: () => apiFetch<OrdenResumen[]>("/migao/ordenes"),
  listarHistorialOrdenes: () => apiFetch<HistorialOrdenEntrada[]>("/migao/ordenes/historial"),
  listarHistorialPropio: () => apiFetch<OrdenHistorialResumen[]>("/migao/ordenes/historial-propio"),
  // Cuentas cerradas con pago "administrativo" — exclusivo de Root/Super Root.
  listarHistorialAdministrativo: () =>
    apiFetch<HistorialAdministrativoEntrada[]>("/migao/ordenes/historial-administrativo"),
  // Historial aparte de propinas — exclusivo de Root/Super Root.
  listarPropinas: () => apiFetch<PropinaEntrada[]>("/migao/propinas"),
  // Reparte (liquida) las propinas pendientes de un método — efectivo y
  // banco por separado, cada uno con su propia periodicidad.
  repartirPropinas: (metodoPago: "efectivo" | "banco", nota?: string) =>
    apiFetch<LiquidacionPropinas>("/migao/propinas/repartir", { method: "POST", body: { metodoPago, nota } }),
  obtenerResumenDiarioIngresos: () =>
    apiFetch<ResumenDiarioIngreso[]>("/migao/ordenes/historial-resumen-diario"),
  obtenerDetalle: (ordenId: string) => apiFetch<OrdenDetalle>(`/migao/ordenes/${ordenId}`),
  cerrarOrden: (ordenId: string, pago: PagoInput, descuentoPorcentaje?: number, propina?: PropinaInput) =>
    apiFetch<{ orden: unknown; venta: unknown; total: number }>(`/migao/ordenes/${ordenId}/cerrar`, {
      method: "POST",
      body: { dividir: false, ...pago, descuentoPorcentaje, ...propina },
    }),
  // Cuenta dividida: cada parte trae su propio método de pago (simple o mixto)
  // y las UNIDADES de producto que le corresponden — un ítem con cantidad 2
  // puede repartirse 1 unidad a cada parte (todas las unidades de la orden
  // deben quedar asignadas, el backend lo valida). La propina, si hay, es
  // un solo valor para toda la cuenta (no por parte) — ver PropinaInput.
  cerrarOrdenDividida: (
    ordenId: string,
    partes: (PagoInput & { unidades: { itemId: number; cantidad: number }[] })[],
    propina?: PropinaInput,
  ) =>
    apiFetch<{ orden: unknown; venta: unknown; total: number }>(`/migao/ordenes/${ordenId}/cerrar`, {
      method: "POST",
      body: { dividir: true, partes, ...propina },
    }),
  cancelarOrden: (ordenId: string) =>
    apiFetch<{ id: string; estado: string }>(`/migao/ordenes/${ordenId}/cancelar`, { method: "POST" }),
  // El mesero cambia la mesa de una orden abierta (ej. los comensales se
  // cambiaron de mesa a mitad del pedido). La mesa se resuelve/crea por
  // número, igual que al crear la orden.
  cambiarMesa: (ordenId: string, mesaNumero: string, piso: number) =>
    apiFetch<{ id: string }>(`/migao/ordenes/${ordenId}/mesa`, {
      method: "PATCH",
      body: { mesaNumero, piso },
    }),
  resetearOrdenes: () =>
    apiFetch<{ ordenesBorradas: number; ventasBorradas: number; pagosBorrados: number; movimientosCajaBorrados: number }>(
      "/migao/ordenes/reset",
      { method: "POST", body: { confirmacion: "REINICIAR ORDENES" } },
    ),
  // Reinicio total exclusivo de Super Root: borra TODO el historial de Migao y
  // de Caja General de una sola vez.
  reiniciarTodo: () =>
    apiFetch<{
      ordenesBorradas: number;
      ventasBorradas: number;
      pagosBorrados: number;
      movimientosCajaBorrados: number;
      turnosBorrados: number;
    }>("/migao/reiniciar-todo", { method: "POST", body: { confirmacion: "REINICIAR TODO" } }),
  listarColaCocina: () => apiFetch<ItemCocina[]>("/migao/cocina/items"),
  listarHistorialDespachados: () => apiFetch<ItemCocina[]>("/migao/cocina/historial"),
  empezarPreparar: (ordenId: string) =>
    apiFetch<ItemCocina[]>(`/migao/ordenes/${ordenId}/empezar-preparar`, { method: "POST" }),
  marcarCheckItem: (itemId: number, listoCocina: boolean) =>
    apiFetch<ItemCocina>(`/migao/items/${itemId}/check`, { method: "PATCH", body: { listoCocina } }),
  marcarOrdenLista: (ordenId: string) =>
    apiFetch<{ items: ItemCocina[]; alertasInventario: string[] }>(`/migao/ordenes/${ordenId}/marcar-listo`, {
      method: "POST",
    }),

  listarProductos: () => apiFetch<Producto[]>("/migao/productos"),
  // Solo los productos marcados "para llevar" — es lo único que ve el Cajero
  // del catálogo, para cobrar envases/cargos adicionales (no tiene acceso al
  // menú completo).
  listarProductosParaLlevar: () => apiFetch<Producto[]>("/migao/productos/para-llevar"),
  crearProducto: (input: {
    nombre: string;
    precio: number;
    costo?: number;
    unidadMedida?: string;
    categoriaId?: number;
    descripcion?: string;
    esParaLlevar?: boolean;
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
      esParaLlevar?: boolean;
    },
  ) => apiFetch<ProductoAdmin>(`/migao/productos/${id}`, { method: "PATCH", body: input }),
  // Vía acotada del Cajero para agregar un cargo "para llevar" al cobrar (ver
  // agregarCargoParaLlevar en el backend: rechaza cualquier producto que no
  // esté marcado así).
  agregarCargoParaLlevar: (
    ordenId: string,
    productoId: string,
    cantidad: number,
    precioUnitario: number,
    observaciones?: string,
  ) =>
    apiFetch<OrdenItem & { alertasInventario: string[] }>(`/migao/ordenes/${ordenId}/items/para-llevar`, {
      method: "POST",
      body: { productoId, cantidad, precioUnitario, observaciones },
    }),
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
    apiFetch<{ id: string; comensal_numero: number; alertasInventario: string[] }>("/migao/ordenes", {
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
    apiFetch<OrdenItem & { alertasInventario: string[] }>(`/migao/ordenes/${ordenId}/items`, {
      method: "POST",
      body: { productoId, cantidad, precioUnitario, observaciones },
    }),
  editarCantidadItem: (itemId: number, cantidad: number, observaciones?: string) =>
    apiFetch<OrdenItem & { alertasInventario: string[] }>(`/migao/items/${itemId}`, {
      method: "PATCH",
      body: { cantidad, observaciones },
    }),
  cancelarItem: (itemId: number) =>
    apiFetch<OrdenItem & { alertasInventario: string[] }>(`/migao/items/${itemId}`, {
      method: "PATCH",
      body: { cancelar: true },
    }),
  entregarItem: (itemId: number) =>
    apiFetch<OrdenItem>(`/migao/items/${itemId}/entregar`, { method: "PATCH" }),

  // Receta de un producto del menú: qué ingredientes de inventario consume.
  obtenerIngredientesProducto: (productoId: string) =>
    apiFetch<IngredienteProducto[]>(`/migao/productos/${productoId}/ingredientes`),
  guardarIngredientesProducto: (
    productoId: string,
    ingredientes: { inventarioProductoId: string; cantidadPorUnidad: number }[],
  ) =>
    apiFetch<{ guardado: boolean }>(`/migao/productos/${productoId}/ingredientes`, {
      method: "PUT",
      body: { ingredientes },
    }),

  // Inventario de Migao: catálogo de insumos "tal como los entrega el
  // proveedor" + stock, consumido automáticamente al vender productos con receta.
  listarInventario: () => apiFetch<InventarioProducto[]>("/migao/inventario/productos"),
  crearInventarioProducto: (input: {
    nombre: string;
    unidadMedida: string;
    unidadesPorPaquete: number;
    tamanoUnidad?: string;
    costoPaquete?: number;
    stockMinimoUnidades?: number;
  }) => apiFetch<InventarioProducto>("/migao/inventario/productos", { method: "POST", body: input }),
  editarInventarioProducto: (
    id: string,
    input: {
      nombre?: string;
      unidadMedida?: string;
      unidadesPorPaquete?: number;
      tamanoUnidad?: string;
      costoPaquete?: number;
      stockMinimoUnidades?: number;
      activo?: boolean;
    },
  ) => apiFetch<InventarioProducto>(`/migao/inventario/productos/${id}`, { method: "PATCH", body: input }),
  eliminarInventarioProducto: (id: string, forzar = false) =>
    apiFetch<{ eliminado: boolean }>(`/migao/inventario/productos/${id}${forzar ? "?forzar=true" : ""}`, {
      method: "DELETE",
    }),
  registrarMovimientoInventario: (
    input:
      | { tipo: "entrada"; productoId: string; paquetes: number; motivo?: string }
      | { tipo: "ajuste"; productoId: string; unidades: number; motivo: string },
  ) =>
    apiFetch<{ producto: InventarioProducto; movimiento: InventarioMovimiento }>("/migao/inventario/movimientos", {
      method: "POST",
      body: input,
    }),
  listarMovimientosInventario: (productoId: string) =>
    apiFetch<InventarioMovimiento[]>(`/migao/inventario/productos/${productoId}/movimientos`),

  // Plano visual de mesas por área. Ver/seleccionar (Mesero, Cajero) solo usa
  // listarMesas(); crear/mover/editar/eliminar es exclusivo del editor
  // (Root/Super Root, migao.mesas.administrar).
  listarMesas: () => apiFetch<Mesa[]>("/migao/mesas"),
  crearMesa: (input: { numero: string; piso: number; capacidad: number; posX: number; posY: number; ancho: number; alto: number }) =>
    apiFetch<Mesa>("/migao/mesas", { method: "POST", body: input }),
  moverMesa: (id: number, input: { posX: number; posY: number; ancho: number; alto: number }) =>
    apiFetch<Mesa>(`/migao/mesas/${id}/posicion`, { method: "PATCH", body: input }),
  editarMesa: (id: number, input: { numero?: string; piso?: number; capacidad?: number; activo?: boolean }) =>
    apiFetch<Mesa>(`/migao/mesas/${id}`, { method: "PATCH", body: input }),
  eliminarMesa: (id: number) => apiFetch<{ eliminada: boolean }>(`/migao/mesas/${id}`, { method: "DELETE" }),
};
