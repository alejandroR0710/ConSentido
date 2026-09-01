import { apiFetch } from "../../shared/api/client";

export type MetodoPago = "efectivo" | "banco";
export type ModuloOrigenSlug = "insumos" | "talleres" | "con_sentido" | "migao" | "pedidos" | "general";

// "mixto" no es un método real (ver backend shared/utils/pago-mixto.ts): el
// backend lo descompone en 1-2 movimientos ya con método puro.
// montoRecibidoEfectivo: obligatorio en un INGRESO cuando hay efectivo de por
// medio (ver caja.service.ts::exigirMontoRecibidoEfectivo) — cuánto entregó
// el cliente, para calcular y dejar registrada la vuelta. No aplica a egresos
// (el campo va en el tipo compartido, pero el backend lo ignora ahí).
export type PagoInput =
  | { metodoPago: "efectivo" | "banco"; monto: number; montoRecibidoEfectivo?: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number; montoRecibidoEfectivo?: number };

// Ítem libre (modo "Agregar productos" del ingreso manual) — nombre en vez
// de producto_id, no hay catálogo detrás (ver caja_ingreso_items en schema.sql).
export interface ItemIngresoInput {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

// Igual que PagoInput pero sin `monto`: al corregir un movimiento ya existente
// el total no cambia, solo cómo se reparte entre los dos métodos.
// `moduloOrigenSlug` es independiente del método: corrige de qué área viene
// el ingreso (el backend la rechaza si el movimiento no es un ingreso).
export type EditarPagoInput = (
  | { metodoPago: "efectivo" | "banco" }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number }
) & { moduloOrigenSlug?: ModuloOrigenSlug };

export interface TurnoCaja {
  id: string;
  cajeroId: string;
  montoInicialEfectivo: string;
  montoInicialBanco: string;
  montoFinalDeclaradoEfectivo: string | null;
  montoFinalCalculadoEfectivo: string | null;
  diferenciaEfectivo: string | null;
  montoFinalCalculadoBanco: string | null;
  estado: "abierto" | "cerrado";
  abiertoEn: string;
  cerradoEn: string | null;
}

export interface Proveedor {
  id: string;
  nombre: string;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
}

export interface MovimientoCaja {
  id: number;
  turno_id: string;
  tipo: "ingreso" | "egreso";
  modulo_origen_id: number | null;
  categoria_gasto_id: number | null;
  referencia_entidad: string | null;
  referencia_id: string | null;
  monto: string;
  // Si hubo descuento, estas dos vienen pobladas (si no, null): `monto` ya es
  // el valor real cobrado/sumado, estas son solo para mostrar el detalle.
  monto_sin_descuento: string | null;
  descuento_porcentaje: string | null;
  metodo_pago: MetodoPago;
  // true en LAS DOS líneas (efectivo + banco) de un pago mixto — nunca en un
  // pago puro. metodo_pago sigue siendo puro, esto es solo para mostrar
  // "Mixta · efectivo"/"Mixta · banco" en vez de solo el método.
  es_pago_mixto: boolean;
  motivo: string | null;
  usuario_id: string | null;
  created_at: string;
  modulo_origen_slug: string | null;
  categoria_gasto_nombre: string | null;
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  // De la venta que originó este ingreso, si la hay — se genera solo al
  // cobrar, no al imprimir (ver migao.service.ts::cerrarOrden).
  numero_factura?: string | null;
}

export interface IngresoPorArea {
  slug: string;
  nombre: string;
  total: number;
}

export interface ResumenTurno {
  turno: TurnoCaja;
  movimientos: MovimientoCaja[];
  saldos: { efectivo: number; banco: number; general: number };
  ingresosPorArea: IngresoPorArea[];
  ingresosEfectivo: number;
  egresosEfectivo: number;
  ingresosBanco: number;
  egresosBanco: number;
}

export interface CategoriaGasto {
  id: number;
  nombre: string;
  activo: boolean;
  // Área por defecto de esta categoría (opcional) — ver
  // caja.repository.ts::crearCategoriaGasto.
  modulo_origen_slug?: ModuloOrigenSlug | null;
  modulo_nombre?: string | null;
}

/** Egreso contra el ACUMULADO TOTAL histórico — no un turno ni un día. */
export interface EgresoAcumulado {
  id: string;
  monto: string;
  metodo_pago: "efectivo" | "banco";
  motivo: string;
  categoria_nombre: string;
  proveedor_nombre: string | null;
  usuario_nombre: string | null;
  created_at: string;
}

export interface AcumuladoTotal {
  ingresosEfectivo: number;
  ingresosBanco: number;
  egresosEfectivo: number;
  egresosBanco: number;
  efectivo: number;
  banco: number;
  egresos: EgresoAcumulado[];
}

export interface DiaHistorialCaja {
  fecha: string;
  ingresos: number;
  egresos: number;
  neto: number;
  movimientos: number;
}

export interface ResetearCajaResultado {
  turnoCerrado: TurnoCaja | null;
  egresosBorrados: number;
}

// Ajustar historial de un día ya cerrado: agregar un movimiento retroactivo,
// o corregir uno existente. Exclusivo de Root/Super Root, ver
// general.caja.editar_movimiento.
export type AgregarMovimientoHistoricoInput =
  | {
      tipo: "ingreso";
      moduloOrigenSlug: ModuloOrigenSlug;
      monto: number;
      metodoPago: MetodoPago;
      motivo?: string;
      nota: string;
      confirmacion: "AJUSTAR HISTORIAL";
    }
  | {
      tipo: "egreso";
      categoriaGastoId: number;
      proveedorId?: string;
      moduloOrigenSlug?: ModuloOrigenSlug;
      monto: number;
      metodoPago: MetodoPago;
      motivo: string;
      nota: string;
      confirmacion: "AJUSTAR HISTORIAL";
    };

export interface EditarMovimientoHistoricoInput {
  monto?: number;
  metodoPago?: MetodoPago;
  motivo?: string;
  moduloOrigenSlug?: ModuloOrigenSlug;
  categoriaGastoId?: number;
  proveedorId?: string;
  nota: string;
  confirmacion: "AJUSTAR HISTORIAL";
}

// `datosAntes`/`datosDespues` son una foto cruda de la fila de movimientos_caja
// en el momento del ajuste (columnas snake_case de la tabla, sin los JOIN de
// módulo/categoría) — se muestran tal cual en el historial de cambios, no se
// tipan de forma estricta.
export interface EdicionHistorialCaja {
  id: number;
  movimientoId: number | null;
  fecha: string;
  accion: "creado" | "editado";
  datosAntes: Record<string, unknown> | null;
  datosDespues: Record<string, unknown>;
  nota: string;
  usuarioId: string;
  usuarioNombre: string | null;
  createdAt: string;
}

// Todo ingreso manual registrado desde Caja General genera su propia venta +
// factura con folio consecutivo (ver caja.service.ts::registrarIngresoManual)
// — a diferencia de un ingreso que ya viene de otro módulo (Migao, Con
// Sentido), que sigue solo como movimientos_caja sin pasar por acá.
export interface RegistrarIngresoResultado {
  movimientos: MovimientoCaja[];
  venta: { id: string };
  factura: { numero: string };
}

export interface FacturaVentaManual {
  numeroFactura: string;
  fecha: string;
  moduloOrigenSlug: string | null;
  usuarioNombre: string | null;
  items: { nombre: string; cantidad: number; precioUnitario: number; subtotal: number }[];
  subtotal: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  total: number;
  pagos: { metodoPago: string; monto: number; referencia: string | null }[];
}

export const cajaApi = {
  obtenerTurnoActual: () => apiFetch<TurnoCaja | null>("/caja/turno-actual"),
  abrirTurno: (montoInicialEfectivo?: number, montoInicialBanco?: number) =>
    apiFetch<TurnoCaja>("/caja/turnos", {
      method: "POST",
      body: { montoInicialEfectivo, montoInicialBanco },
    }),
  cerrarTurno: (turnoId: string, montoFinalDeclaradoEfectivo: number) =>
    apiFetch<TurnoCaja>(`/caja/turnos/${turnoId}/cerrar`, {
      method: "PATCH",
      body: { montoFinalDeclaradoEfectivo },
    }),
  obtenerResumenTurno: (turnoId: string) => apiFetch<ResumenTurno>(`/caja/turnos/${turnoId}/resumen`),
  // Todo ingreso registrado desde acá (sin referenciaEntidad: eso es exclusivo
  // de otros módulos llamando internamente) genera su propia venta+factura —
  // ver RegistrarIngresoResultado.
  registrarIngreso: (
    input: {
      moduloOrigenSlug: ModuloOrigenSlug;
      motivo?: string;
      descuentoPorcentaje?: number;
      items?: ItemIngresoInput[];
    } & PagoInput,
  ) => apiFetch<RegistrarIngresoResultado>("/caja/ingresos", { method: "POST", body: input }),
  obtenerFacturaVenta: (ventaId: string) => apiFetch<FacturaVentaManual>(`/caja/ventas/${ventaId}/factura`),
  registrarEgreso: (
    input: {
      categoriaGastoId: number;
      motivo: string;
      proveedorId?: string;
      moduloOrigenSlug?: ModuloOrigenSlug;
    } & PagoInput,
  ) => apiFetch<MovimientoCaja[]>("/caja/egresos", { method: "POST", body: input }),
  // Egreso contra el ACUMULADO TOTAL histórico — no un turno ni un día, y no
  // requiere turno abierto (a diferencia de registrarEgreso de arriba).
  registrarEgresoAcumulado: (input: {
    categoriaGastoId: number;
    motivo: string;
    proveedorId?: string;
    metodoPago: "efectivo" | "banco";
    monto: number;
  }) => apiFetch<EgresoAcumulado>("/caja/egresos-acumulado", { method: "POST", body: input }),
  obtenerAcumuladoTotal: () => apiFetch<AcumuladoTotal>("/caja/acumulado"),
  listarProveedores: () => apiFetch<Proveedor[]>("/caja/proveedores"),
  crearProveedor: (nombre: string, contacto?: string, telefono?: string, email?: string) =>
    apiFetch<Proveedor>("/caja/proveedores", {
      method: "POST",
      body: { nombre, contacto, telefono, email },
    }),
  actualizarProveedor: (id: string, nombre?: string, contacto?: string, telefono?: string, email?: string) =>
    apiFetch<Proveedor>(`/caja/proveedores/${id}`, {
      method: "PATCH",
      body: { nombre, contacto, telefono, email },
    }),
  desactivarProveedor: (id: string) =>
    apiFetch<Proveedor>(`/caja/proveedores/${id}`, {
      method: "DELETE",
    }),
  editarMetodoPagoMovimiento: (movimientoId: number | string, input: EditarPagoInput) =>
    apiFetch<MovimientoCaja[]>(`/caja/movimientos/${movimientoId}/metodo-pago`, {
      method: "PATCH",
      body: input,
    }),
  listarCategoriasGasto: () => apiFetch<CategoriaGasto[]>("/caja/categorias-gasto"),
  crearCategoriaGasto: (nombre: string, moduloOrigenSlug?: ModuloOrigenSlug) =>
    apiFetch<CategoriaGasto>("/caja/categorias-gasto", { method: "POST", body: { nombre, moduloOrigenSlug } }),
  actualizarCategoriaGasto: (id: number, nombre: string, moduloOrigenSlug?: ModuloOrigenSlug) =>
    apiFetch<CategoriaGasto>(`/caja/categorias-gasto/${id}`, {
      method: "PATCH",
      body: { nombre, moduloOrigenSlug },
    }),
  obtenerHistorialAnual: (anio: number) => apiFetch<DiaHistorialCaja[]>(`/caja/historial?anio=${anio}`),
  resetear: () =>
    apiFetch<ResetearCajaResultado>("/caja/reset", {
      method: "POST",
      body: { confirmacion: "REINICIAR CAJA" },
    }),
  listarTurnosPorFecha: (fecha: string) => apiFetch<TurnoCaja[]>(`/caja/turnos-por-fecha?fecha=${fecha}`),
  listarMovimientosPorFecha: (fecha: string) =>
    apiFetch<MovimientoCaja[]>(`/caja/movimientos-por-fecha?fecha=${fecha}`),
  // Borrados permanentes, exclusivos de Super Root: a diferencia de resetear(),
  // estos sí borran datos y no se pueden deshacer.
  borrarHistorialDia: (fecha: string) =>
    apiFetch<{ movimientosBorrados: number }>("/caja/historial/borrar-dia", {
      method: "POST",
      body: { fecha, confirmacion: "BORRAR HISTORIAL DEL DIA" },
    }),
  borrarTurno: (turnoId: string) =>
    apiFetch<{ movimientosBorrados: number }>(`/caja/turnos/${turnoId}`, {
      method: "DELETE",
      body: { confirmacion: "BORRAR TURNO" },
    }),
  agregarMovimientoHistorico: (fecha: string, input: AgregarMovimientoHistoricoInput) =>
    apiFetch<MovimientoCaja>(`/caja/historial/${fecha}/movimientos`, { method: "POST", body: input }),
  editarMovimientoHistorico: (movimientoId: number | string, input: EditarMovimientoHistoricoInput) =>
    apiFetch<MovimientoCaja>(`/caja/movimientos/${movimientoId}/historico`, { method: "PATCH", body: input }),
  listarEdicionesDelDia: (fecha: string) =>
    apiFetch<EdicionHistorialCaja[]>(`/caja/historial/${fecha}/ediciones`),
  // Anula una venta (Migao o Con Sentido) desde cualquier día del historial —
  // Root o Super Root. Nunca borra la venta de verdad, solo sus
  // pagos/movimientos de Caja (ver caja.service.ts::anularVenta).
  anularVenta: (movimientoId: number | string, nota: string) =>
    apiFetch<{ movimientosAnulados: number }>(`/caja/movimientos/${movimientoId}/anular-venta`, {
      method: "POST",
      body: { nota, confirmacion: "ANULAR VENTA" },
    }),
};
