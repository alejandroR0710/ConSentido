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
  // Etiqueta libre de la cuenta (ej. "Cumpleaños de Juan"), editable desde
  // "cambiar mesa" — distinto de cliente_nombre (cliente real reutilizable).
  nombre: string | null;
  cliente_nombre: string | null;
  mesero_nombre: string | null;
  total: string;
  // Solo > 0 cuando estado === 'pagando' (motor de pagos parciales/cuenta
  // dividida) — cuánto le falta a la cuenta para terminar de pagarse.
  pendiente_cobro: string;
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
  // Se genera solo al cobrar (ver migao.service.ts::cerrarOrden), así que
  // siempre debería venir poblado para toda venta ya cerrada.
  numero_factura: string | null;
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
  numero_factura: string | null;
}

export interface ItemHistorialCancelado {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

/** Orden cancelada: nunca generó un peso, vive en su propio historial con el
 *  detalle completo de qué se había pedido (ver HistorialCanceladosPage). */
export interface HistorialCanceladoEntrada {
  id: string;
  created_at: string;
  closed_at: string | null;
  comensal_numero: number | null;
  numero_personas: number | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  mesero_nombre: string | null;
  total: string;
  items: ItemHistorialCancelado[];
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
  // null = todavía no se ha cobrado; con valor, qué venta ya lo pagó (ver
  // migaoApi.pagarItems) — permite cobrar productos sueltos de una cuenta
  // que sigue abierta, sin bloquear seguir agregando productos nuevos.
  venta_id: string | null;
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
    nombre: string | null;
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

export interface IngredienteLimitante {
  nombre: string;
  // A diferencia de otros campos NUMERIC de la API (que llegan como texto),
  // este viene de json_build_object en la consulta — Postgres ya lo entrega
  // como número JSON limpio, sin decimales de sobra.
  stockUnidades: number;
  unidadMedida: string;
  // true = ya no alcanza ni para 1 unidad más (sin_stock); false = alcanza
  // pero ya cruzó su mínimo (bajo_stock) — ver migao.repository.ts::listProductosMigao.
  sinStock: boolean;
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
  // Cuál(es) ingrediente(s) de la receta son el problema — un producto puede
  // tener varios, y el que le falta stock no siempre es el más obvio.
  ingredientes_limitantes: IngredienteLimitante[] | null;
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

export interface CategoriaInventario {
  id: number;
  nombre: string;
}

export interface InventarioProducto {
  id: string;
  nombre: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
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

export interface InventarioMovimientoGlobal extends InventarioMovimiento {
  producto_nombre: string;
}

/** Una salida de inventario por consumo automático de una orden (nunca a
 *  mano) — el insumo que se descontó al servir un producto del menú. */
export interface ConsumoInventarioEntrada {
  id: number;
  insumo_nombre: string;
  cantidad_unidades: string;
  unidad_medida: string;
  created_at: string;
  orden_id: string | null;
  mesa_numero: string | null;
  mesa_piso: number | null;
  orden_nombre: string | null;
  mesero_nombre: string | null;
  producto_nombre: string | null;
  cantidad_producto: string | null;
  numero_factura: string | null;
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
  // De la venta que generó esta propina — permite ubicar la cuenta exacta
  // (y agrupar visualmente varias propinas de una misma cuenta dividida,
  // que comparten el mismo número).
  numero_factura: string | null;
}

/** Propina opcional (5%/10%/valor voluntario), calculada una sola vez sobre
 *  el valor de la cuenta — nunca entra a la validación de mixto ni a Caja
 *  General (ver migao.service.ts::cerrarOrden). */
export interface PropinaInput {
  propina?: number;
  propinaPorcentaje?: number | null;
  propinaMetodoPago?: "efectivo" | "banco";
}

// Cobrar productos sueltos de una cuenta que sigue abierta — motor NUEVO y
// aparte de PagoInput/cerrarOrden e iniciarCobro/dividir cuenta: no fija de
// antemano cómo queda partida la cuenta, cada llamada cobra lo que el
// cajero seleccione ahí mismo y genera su propia venta+factura.
export type PagarItemsInput = ({ metodoPago: "efectivo" | "banco" } | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number }) &
  PropinaInput & { itemIds: number[] };

export interface PagarItemsResultado {
  venta: { id: string };
  total: number;
  ordenCerrada: boolean;
}

// Motor NUEVO y aparte de PagoInput/PropinaInput de arriba: cómo queda
// partida la cuenta al iniciar el cobro con pagos parciales y/o cuenta
// dividida por igual — "no dividir" es, acá, numPartes/partes de longitud 1.
export type DivisionInput =
  | { modo: "igual"; numPartes: number }
  | { modo: "producto"; partes: { unidades: { itemId: number; cantidad: number }[] }[] };

/** Propina de ESTE abono puntual — a diferencia de PropinaInput de arriba
 *  (una sola vez, sobre toda la cuenta), cada abono trae la suya. */
export interface PropinaAbonoInput {
  monto: number;
  porcentaje?: number | null;
}

export type RegistrarAbonoInput =
  | { metodoPago: "efectivo" | "banco"; monto: number; propina?: PropinaAbonoInput }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number; propina?: PropinaAbonoInput };

/** Una unidad de producto asignada a una parte (modo 'producto') — solo
 *  informativo, para mostrar "Parte 2: 1x Americano". */
export interface CuentaParteUnidad {
  itemId: number;
  cantidad: number;
  productoNombre: string;
}

export interface CuentaParte {
  id: string;
  indice: number;
  modo: "producto" | "igual";
  montoDebido: number;
  montoPagado: number;
  pendiente: number;
  unidades: CuentaParteUnidad[];
}

export interface CuentaAbono {
  parteId: string;
  metodoPago: string;
  monto: number;
  fecha: string;
}

/** Estado completo de una cuenta con el motor nuevo de cobro — se usa tanto
 *  al iniciar el cobro como al reabrir una orden en 'pagando' para seguir
 *  registrando abonos donde se quedó. */
export interface CuentaDetalle {
  venta: { id: string; orden_id: string; total: string };
  ordenEstado: string;
  partes: CuentaParte[];
  pagos: CuentaAbono[];
  propinas: CuentaAbono[];
}

/** Reparto (liquidación) de las propinas pendientes — un solo reparto puede
 *  cubrir efectivo y banco a la vez (montos separados); a quién se le paga en
 *  cada método lo decide cada entrega, no el reparto entero. `fecha_desde`/
 *  `fecha_hasta` son el rango de los días elegidos para ese reparto (null en
 *  liquidaciones viejas, de antes de poder elegir días concretos). */
export interface LiquidacionPropinas {
  id: string;
  monto_efectivo: string;
  monto_banco: string;
  monto: string;
  nota: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  created_at: string;
}

/** Pendiente en UN día concreto (hora Colombia), efectivo y banco
 *  desglosados — el panel de reparto lo usa para dejar elegir qué días
 *  entran (una semana completa o sueltos), en vez de forzar a repartir TODO
 *  lo pendiente de una vez. */
export interface PendientePropinaDia {
  fecha: string;
  montoEfectivo: number;
  montoBanco: number;
}

/** Una persona a la que se le entrega parte del monto repartido, con el
 *  método en que se le paga a ELLA (no tiene que coincidir con el método en
 *  que vino la propina original) — la suma de las entregas en efectivo debe
 *  dar exactamente el pendiente en efectivo seleccionado, y lo mismo banco. */
export interface EntregaPropinaInput {
  nombrePersona: string;
  metodoPago: "efectivo" | "banco";
  monto: number;
  fechaEntrega?: string;
  motivo?: string;
}

/** Historial de a quién se le entregó cuánto — desglose de una liquidación,
 *  con su propia fecha (puede registrarse días después) y motivo opcional. */
export interface EntregaPropina {
  id: string;
  liquidacion_id: string;
  nombre_persona: string;
  monto: string;
  fecha_entrega: string;
  motivo: string | null;
  created_at: string;
  metodo_pago: "efectivo" | "banco";
  liquidacion_fecha_desde: string | null;
  liquidacion_fecha_hasta: string | null;
  usuario_nombre: string | null;
}

/** Factura imprimible de una venta ya cobrada — reconstruida en vivo desde
 *  ventas/venta_items/pagos/migao_propinas (ver migao.service.ts::obtenerFacturaOrden)
 *  o, para Con Sentido, desde con_sentido_ventas (ver con_sentido.service.ts::
 *  obtenerFacturaVenta, mismo formato normalizado para reusar este mismo tipo).
 *  `pagos` trae UNA línea por método (una cuenta dividida en 3 trae 3 líneas).
 *  Mesa/mesero/comensal quedan `null` cuando la venta no es de Migao. */
export interface FacturaItem {
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}
export interface FacturaPago {
  metodoPago: string;
  monto: number;
  referencia: string | null;
}
export interface FacturaOrden {
  numeroFactura: string;
  fecha: string;
  mesaNumero: string | null;
  mesaPiso: number | null;
  meseroNombre: string | null;
  comensalNumero: number | null;
  items: FacturaItem[];
  subtotal: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  total: number;
  pagos: FacturaPago[];
  propina: { monto: number; porcentaje: number | null; metodoPago: "efectivo" | "banco" } | null;
}

/** Cotización: presupuesto para un cliente ANTES de una orden/venta real —
 *  no toca inventario/caja/ordenes (ver migao_cotizaciones en schema.sql). */
export interface CotizacionItem {
  id: number;
  nombre: string;
  cantidad: string;
  precio_unitario: string;
  subtotal: string;
}
export interface CotizacionResumen {
  id: string;
  numero: string;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  nota: string | null;
  subtotal: string;
  total: string;
  created_at: string;
  usuario_nombre: string | null;
}
export interface CotizacionDetalle extends CotizacionResumen {
  items: CotizacionItem[];
}

// Amasijos y bases: NO tienen inventario propio — son productos normales del
// Inventario general de Migao (mismo stock, mismo stock mínimo). Vender un
// producto del menú que sea un amasijo/base (ej. "Almojábana" o "Migao
// Valluno") ya descuenta este inventario solo, vía su receta normal en
// migao_producto_ingredientes — sin código aparte.
export interface AmasijoInventario {
  id: string;
  nombre: string;
  stockUnidades: number;
  stockMinimoUnidades: number | null;
}

export interface RecomendacionBase {
  baseProductoId: string;
  baseNombre: string;
  cantidadRecomendada: number;
  limitantes: Array<{
    amasijoNombre: string;
    disponibleSobreMinimo: number;
    necesario: number;
  }>;
}

/** Resultado de preparar TODO el lote recomendado de una vez — una fila por
 *  cada base que sí tenía algo recomendado (cantidadRecomendada === 0 no
 *  aparece acá). */
export interface PreparacionLote {
  baseProductoId: string;
  baseNombre: string;
  cantidadPreparada: number;
  alertasInventario: string[];
}

// Receta de una base: qué amasijos (y cuánto de cada uno) hacen falta para
// prepararla — se edita desde la pantalla de Amasijos.
export interface RecetaLinea {
  id: string;
  base_producto_id: string;
  base_nombre: string;
  amasijo_producto_id: string;
  amasijo_nombre: string;
  cantidad_amasijo: number;
}

export const migaoApi = {
  listarOrdenesAbiertas: () => apiFetch<OrdenResumen[]>("/migao/ordenes"),
  listarHistorialOrdenes: () => apiFetch<HistorialOrdenEntrada[]>("/migao/ordenes/historial"),
  listarHistorialPropio: () => apiFetch<OrdenHistorialResumen[]>("/migao/ordenes/historial-propio"),
  // Cuentas cerradas con pago "administrativo" — exclusivo de Root/Super Root.
  listarHistorialAdministrativo: () =>
    apiFetch<HistorialAdministrativoEntrada[]>("/migao/ordenes/historial-administrativo"),
  // Órdenes canceladas — exclusivo de Root/Super Root.
  listarHistorialCancelado: () => apiFetch<HistorialCanceladoEntrada[]>("/migao/ordenes/historial-cancelado"),
  // Historial aparte de propinas — exclusivo de Root/Super Root.
  listarPropinas: () => apiFetch<PropinaEntrada[]>("/migao/propinas"),
  // Pendiente por día (efectivo y banco desglosados) — para elegir qué días
  // concretos (una semana completa o sueltos) entran en el reparto.
  obtenerPendientesPropinasPorDia: () => apiFetch<PendientePropinaDia[]>("/migao/propinas/pendientes-por-dia"),
  // Propinas de HOY (efectivo/banco) — cuadro aparte en el resumen de Caja
  // General, sin importar si ya se repartieron o no.
  obtenerPropinasHoy: () => apiFetch<{ montoEfectivo: number; montoBanco: number }>("/migao/propinas/hoy"),
  // Reparte (liquida) las propinas pendientes — un solo reparto cubre
  // efectivo y banco a la vez. `fechas` deja elegir qué días concretos
  // entran (sin mandarlo, reparte TODO lo pendiente). `entregas` desglosa el
  // monto entre las personas del equipo, cada una con su propio método de
  // pago — la suma de las entregas en efectivo debe dar exactamente el
  // pendiente en efectivo elegido, y lo mismo banco.
  repartirPropinas: (input: { fechas?: string[]; nota?: string; entregas: EntregaPropinaInput[] }) =>
    apiFetch<LiquidacionPropinas & { entregas: EntregaPropina[] }>("/migao/propinas/repartir", {
      method: "POST",
      body: input,
    }),
  // Historial de a quién se le entregó cuánto, en todas las liquidaciones.
  listarEntregasPropinas: () => apiFetch<EntregaPropina[]>("/migao/propinas/entregas"),
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
  // Motor nuevo, aparte de cerrarOrden/cerrarOrdenDividida de arriba: pagos
  // parciales y/o cuenta dividida por igual (no solo por producto). Una
  // cuenta sin dividir es, acá, una división de 1 sola parte.
  iniciarCobro: (ordenId: string, division: DivisionInput, descuentoPorcentaje?: number) =>
    apiFetch<CuentaDetalle>(`/migao/ordenes/${ordenId}/cobro`, {
      method: "POST",
      body: { division, descuentoPorcentaje },
    }),
  // Reabre una orden en 'pagando' con su estado real (partes, pagado/pendiente
  // de cada una, abonos ya hechos) — null si esta orden nunca inició este cobro.
  obtenerCuenta: (ordenId: string) => apiFetch<CuentaDetalle>(`/migao/ordenes/${ordenId}/cobro`),
  // Un abono puntual de UNA parte — puede ser el pago completo de esa parte
  // o solo una porción (pago parcial). La propina de este abono, si trae, es
  // independiente de la de otros abonos de la misma cuenta.
  registrarAbono: (parteId: string, input: RegistrarAbonoInput) =>
    apiFetch<CuentaDetalle>(`/migao/cuentas/partes/${parteId}/abonos`, { method: "POST", body: input }),
  // Cobra solo ALGUNOS productos de una cuenta que sigue abierta — genera su
  // propia venta+factura independiente (ver PagarItemsResultado), la mesa
  // sigue aceptando productos nuevos. No se combina con iniciarCobro/dividir
  // cuenta para la misma orden (motor de partes de arriba).
  pagarItems: (ordenId: string, input: PagarItemsInput) =>
    apiFetch<PagarItemsResultado>(`/migao/ordenes/${ordenId}/pagar-items`, { method: "POST", body: input }),
  cancelarOrden: (ordenId: string) =>
    apiFetch<{ id: string; estado: string }>(`/migao/ordenes/${ordenId}/cancelar`, { method: "POST" }),
  // El mesero cambia la mesa de una orden abierta (ej. los comensales se
  // cambiaron de mesa a mitad del pedido). La mesa se resuelve/crea por
  // número, igual que al crear la orden.
  cambiarMesa: (ordenId: string, mesaNumero: string, piso: number, nombre?: string) =>
    apiFetch<{ id: string }>(`/migao/ordenes/${ordenId}/mesa`, {
      method: "PATCH",
      body: { mesaNumero, piso, nombre },
    }),
  // Aparte de cambiarMesa: Caja Migao también puede ponerle/cambiarle/
  // borrarle el nombre a una cuenta sin necesitar el permiso de cambiar
  // mesa — "" sí borra el nombre acá.
  editarNombreOrden: (ordenId: string, nombre: string) =>
    apiFetch<{ id: string }>(`/migao/ordenes/${ordenId}/nombre`, {
      method: "PATCH",
      body: { nombre },
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
  listarCategoriasInventario: () => apiFetch<CategoriaInventario[]>("/migao/inventario/categorias"),
  crearCategoriaInventario: (nombre: string) =>
    apiFetch<CategoriaInventario>("/migao/inventario/categorias", { method: "POST", body: { nombre } }),
  crearInventarioProducto: (input: {
    nombre: string;
    categoriaId?: number;
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
      categoriaId?: number;
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
  // Si la entrada es de una base con receta configurada (ej. "Base Valluno"),
  // el backend la resuelve como preparación: descuenta los amasijos según la
  // receta y devuelve sus avisos acá — mismo comportamiento que "Preparar"
  // desde el módulo de Amasijos, sin importar desde dónde se registre.
  registrarMovimientoInventario: (
    input:
      | { tipo: "entrada"; productoId: string; paquetes: number; motivo?: string }
      | { tipo: "ajuste"; productoId: string; unidades: number; motivo: string },
  ) =>
    apiFetch<{ producto: InventarioProducto; movimiento: InventarioMovimiento; alertasInventario: string[] }>(
      "/migao/inventario/movimientos",
      { method: "POST", body: input },
    ),
  listarMovimientosInventario: (productoId: string) =>
    apiFetch<InventarioMovimiento[]>(`/migao/inventario/productos/${productoId}/movimientos`),
  // Historial global (todos los productos) de ingresos o de ajustes.
  listarMovimientosInventarioGlobal: (tipo: "entrada" | "ajuste") =>
    apiFetch<InventarioMovimientoGlobal[]>(`/migao/inventario/movimientos?tipo=${tipo}`),
  // Historial de salidas por consumo automático de órdenes — solo lectura.
  listarConsumoInventario: () => apiFetch<ConsumoInventarioEntrada[]>("/migao/inventario/consumo"),

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

  // Factura imprimible de una orden ya cobrada — la primera vez que se pide
  // se le asigna número (get-or-create), reimprimir después trae el mismo.
  obtenerFactura: (ordenId: string) => apiFetch<FacturaOrden>(`/migao/ordenes/${ordenId}/factura`),
  // Igual que arriba, pero desde Caja General: ahí los movimientos guardan el
  // venta_id (no el orden_id) — ver migao.service.ts::obtenerFacturaVenta.
  obtenerFacturaPorVenta: (ventaId: string) => apiFetch<FacturaOrden>(`/migao/ventas/${ventaId}/factura`),

  // Cotizaciones: presupuesto para un cliente, no toca inventario/caja/ordenes.
  listarCotizaciones: () => apiFetch<CotizacionResumen[]>("/migao/cotizaciones"),
  obtenerCotizacion: (id: string) => apiFetch<CotizacionDetalle>(`/migao/cotizaciones/${id}`),
  crearCotizacion: (input: {
    clienteNombre?: string;
    clienteTelefono?: string;
    nota?: string;
    items: { nombre: string; cantidad: number; precioUnitario: number }[];
  }) => apiFetch<CotizacionDetalle>("/migao/cotizaciones", { method: "POST", body: input }),
  eliminarCotizacion: (id: string) =>
    apiFetch<{ eliminada: boolean }>(`/migao/cotizaciones/${id}`, { method: "DELETE" }),

  // Amasijos y bases: viven en el Inventario general de Migao (arriba) — acá
  // solo la recomendación de preparación y la receta de cada base.
  listarAmasijos: () => apiFetch<AmasijoInventario[]>("/migao/amasijos"),
  listarBases: () => apiFetch<AmasijoInventario[]>("/migao/bases"),
  obtenerRecomendacionesPreparacion: () => apiFetch<RecomendacionBase[]>("/migao/bases/recomendaciones"),
  prepararBase: (input: { baseProductoId: string; cantidad: number }) =>
    apiFetch<{ baseProductoId: string; cantidad: number; alertas: string[] }>("/migao/bases/preparar", {
      method: "POST",
      body: input,
    }),
  // Prepara TODAS las bases recomendadas de una sola vez, en un solo lote
  // atómico — evita el problema de preparar una base a la vez (consumiría
  // amasijos que las demás recetas también necesitan, dejando la
  // recomendación de las otras 3 desactualizada a mitad de camino).
  prepararRecomendado: () => apiFetch<PreparacionLote[]>("/migao/bases/preparar-recomendado", { method: "POST" }),
  obtenerRecetas: () => apiFetch<RecetaLinea[]>("/migao/recetas"),
  crearRecetaLinea: (input: { baseProductoId: string; amasijoProductoId: string; cantidadAmasijo: number }) =>
    apiFetch<{ id: string }>("/migao/recetas", { method: "POST", body: input }),
  actualizarRecetaLinea: (recetaId: string, cantidadAmasijo: number) =>
    apiFetch<{ id: string }>(`/migao/recetas/${recetaId}`, { method: "PATCH", body: { cantidadAmasijo } }),
  eliminarRecetaLinea: (recetaId: string) =>
    apiFetch<{ eliminada: boolean }>(`/migao/recetas/${recetaId}`, { method: "DELETE" }),
};
