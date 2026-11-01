import { apiFetch } from "../../shared/api/client";

/**
 * Cliente de los 7 endpoints de datos del módulo Reportes (Tasks 2-8,
 * backend), montados en `/api/v1/reportes/*` (ver backend/src/app.ts), todos
 * gateados por el permiso `general.dashboard.analytics.ver` igual que
 * `analyticsApi` en `../general/api.ts` (mismo patrón de cliente: `apiFetch`
 * ya resuelve la base URL, `credentials`, el token y el parseo de
 * `ApiError` — ver `../../shared/api/client.ts`).
 *
 * Los tipos de abajo son un espejo manual (no un `import` cruzado) de
 * `backend/src/modules/reportes/reportes.types.ts` — mismo criterio que
 * `AnalyticsGeneral`/`AnalyticsInsumos`/etc. en `../general/api.ts`, que
 * tampoco importan los tipos de `backend/.../analytics.types.ts` directo.
 * Las funciones de exportar a Excel (`GET /:tipo/exportar`) las agrega
 * Task 18 — no viven aquí.
 */

/** Reporte "Resumen" — Bloques A-E. */
export interface ResumenTotales {
  ingresos_total: number;
  gastos_total: number;
  utilidad: number;
  cuentas_por_pagar: null;
  utilidad_real_disponible: number;
}

export interface ResumenFlujoPorMetodoPago {
  ingresos_efectivo: number;
  ingresos_banco: number;
  gastos_efectivo: number;
  gastos_banco: number;
  disponible_efectivo: number;
  disponible_banco: number;
  total_disponible: number;
}

export interface ResumenGastoCategoria {
  id: number;
  nombre: string;
  total: number;
}

export interface ResumenIngresoTipo {
  slug: string;
  total: number;
}

export interface ResumenVentasPorMesFila {
  slug: string;
  valores: Record<string, number>;
}

export interface ResumenVentasPorMes {
  meses: string[];
  filas: ResumenVentasPorMesFila[];
}

export interface ResumenReporte {
  totales: ResumenTotales;
  flujoPorMetodoPago: ResumenFlujoPorMetodoPago;
  gastosPorCategoria: ResumenGastoCategoria[];
  ingresosPorTipo: ResumenIngresoTipo[];
  ventasPorMes: ResumenVentasPorMes;
}

/** Reporte "Ventas" — detalle de ventas de mostrador + ingresos sin línea
 *  de producto propia (abonos, ingresos manuales...). */
export interface VentasFiltros {
  desde: string;
  hasta: string;
  metodo?: "efectivo" | "banco";
  cliente?: string;
  producto?: string;
}

export interface VentasFilaDetalle {
  tipo: "detalle";
  id: string;
  fecha: string;
  producto: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  metodo_pago: "efectivo" | "banco" | "mixto" | null;
  area: string | null;
  consecutivo: string | null;
}

export interface VentasFilaSinDetalle {
  tipo: "sin_detalle";
  id: string;
  fecha: string;
  producto: string | null;
  cantidad: null;
  precio_unitario: null;
  subtotal: number;
  metodo_pago: "efectivo" | "banco";
  area: string | null;
  consecutivo: null;
}

export type VentasFila = VentasFilaDetalle | VentasFilaSinDetalle;

export interface VentasPorDia {
  fecha: string;
  total: number;
}

export interface VentasTotalesReporte {
  total_general: number;
  total_efectivo: number;
  total_bancos: number;
}

export interface VentasReporte {
  filas: VentasFila[];
  porDia: VentasPorDia[];
  totales: VentasTotalesReporte;
}

/** Reporte "Ventas por tipo" — pivot diario de las 3 líneas de negocio. */
export interface VentasPorTipoDiaFila {
  fecha: string;
  insumos: number;
  con_sentido: number;
  talleres: number;
  total: number;
}

export interface VentasPorTipoTotales {
  insumos: number;
  con_sentido: number;
  talleres: number;
  total: number;
}

export interface VentasPorTipoParticipacion {
  insumos: number;
  con_sentido: number;
  talleres: number;
}

export interface VentasPorTipoReporte {
  porDia: VentasPorTipoDiaFila[];
  totales: VentasPorTipoTotales;
  participacion: VentasPorTipoParticipacion;
}

/** Reporte "Gastos" — detalle de egresos + ranking de proveedores + gastos
 *  por categoría (reusa la misma forma que el Bloque C del Resumen). */
export interface GastosFiltros {
  desde: string;
  hasta: string;
  categoriaId?: number;
  proveedorId?: string;
  metodo?: "efectivo" | "banco";
}

export interface GastoFila {
  id: string;
  fecha: string;
  proveedor: string | null;
  categoria: string;
  motivo: string | null;
  monto: number;
  metodo_pago: "efectivo" | "banco";
}

export interface GastoProveedorTotal {
  id: string;
  nombre: string;
  total: number;
}

export interface GastosTotalesReporte {
  total_general: number;
  total_efectivo: number;
  total_bancos: number;
}

export interface GastosReporte {
  filas: GastoFila[];
  topProveedores: GastoProveedorTotal[];
  gastosPorCategoria: ResumenGastoCategoria[];
  totales: GastosTotalesReporte;
}

/** Reporte "Cierre de caja diario" — única excepción de alcance del módulo:
 *  caja física real y única del POS completo, sin filtrar por módulo. Se
 *  filtra por `mes` (YYYY-MM), no por `desde`/`hasta`. */
export interface CierreCajaFila {
  /** `YYYY-MM-DD`, o literal `"TOTAL"` para la fila de cierre. */
  fecha: string;
  venta_efectivo: number;
  venta_banco: number;
  venta_dia: number;
  gastos_efectivo: number;
  gastos_banco: number;
  efectivo: number;
  banco: number;
  total_dinero: number;
  notas_responsable: string;
}

export interface CierreCajaSaldoInicial {
  efectivo: number;
  banco: number;
}

export interface CierreCajaReporte {
  mes: string;
  /** `null` (dato no disponible) si no existe ningún turno registrado hasta
   *  ese mes — nunca `0`. */
  saldo_inicial: CierreCajaSaldoInicial | null;
  dias: CierreCajaFila[];
  total: CierreCajaFila;
}

/** Reporte "Conciliación" — verificación cruzada día por día entre el total
 *  por método de pago y el total por línea de negocio. */
export interface ConciliacionFila {
  fecha: string;
  total_por_metodo: number;
  total_por_tipo: number;
  diferencia: number;
  tiene_diferencia: boolean;
}

export interface ConciliacionReporte {
  dias: ConciliacionFila[];
}

/** Reporte "Préstamos" — basado en `vales`, sin filtro de fecha obligatorio
 *  (selector de destinatario, no de período). */
export interface PrestamoFila {
  id: string;
  numero: string;
  tipo: "deuda" | "pago";
  pagado_a: string;
  destinatario_usuario_id: string | null;
  concepto: string;
  monto: number;
  estado: string;
  fecha_resolucion: string | null;
  created_at: string;
}

export interface PrestamosTotales {
  total_pendiente: number;
  total_resuelto: number;
}

export interface PrestamosReporte {
  filas: PrestamoFila[];
  totales: PrestamosTotales;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const reportesApi = {
  obtenerResumen: (desde: string, hasta: string) =>
    apiFetch<ResumenReporte>(`/reportes/resumen${buildQuery({ desde, hasta })}`),

  obtenerVentas: (filtros: VentasFiltros) =>
    apiFetch<VentasReporte>(`/reportes/ventas${buildQuery({ ...filtros })}`),

  obtenerVentasPorTipo: (desde: string, hasta: string) =>
    apiFetch<VentasPorTipoReporte>(`/reportes/ventas-por-tipo${buildQuery({ desde, hasta })}`),

  obtenerGastos: (filtros: GastosFiltros) =>
    apiFetch<GastosReporte>(`/reportes/gastos${buildQuery({ ...filtros })}`),

  // Único reporte filtrado por `mes` (YYYY-MM), no por `desde`/`hasta` — ver
  // reportes.schema.ts::reportesCierreCajaSchema en el backend.
  obtenerCierreCaja: (mes: string) =>
    apiFetch<CierreCajaReporte>(`/reportes/cierre-caja${buildQuery({ mes })}`),

  // Sin rango obligatorio (Spec: selector de destinatario, no de período).
  obtenerPrestamos: (destinatarioUsuarioId?: string) =>
    apiFetch<PrestamosReporte>(`/reportes/prestamos${buildQuery({ destinatarioUsuarioId })}`),

  obtenerConciliacion: (desde: string, hasta: string) =>
    apiFetch<ConciliacionReporte>(`/reportes/conciliacion${buildQuery({ desde, hasta })}`),
};
