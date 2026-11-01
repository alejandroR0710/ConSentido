/**
 * Reporte "Resumen" — Bloques A-E (ver reportes.repository.ts/reportes.service.ts).
 */

/** Bloque A: KPIs generales del rango. */
export interface ResumenTotales {
  ingresos_total: number;
  gastos_total: number;
  utilidad: number;
  /** Dato no disponible (no existe "cuentas por pagar" en el sistema hoy) —
   *  siempre `null`, nunca `0`, para no confundir "sin deuda" con "no se sabe". */
  cuentas_por_pagar: null;
  utilidad_real_disponible: number;
}

/** Bloque B: flujo de caja por medio de pago. */
export interface ResumenFlujoPorMetodoPago {
  ingresos_efectivo: number;
  ingresos_banco: number;
  gastos_efectivo: number;
  gastos_banco: number;
  disponible_efectivo: number;
  disponible_banco: number;
  total_disponible: number;
}

/** Bloque C: gastos por categoría (todas las categorías activas, incluidas en 0). */
export interface ResumenGastoCategoria {
  id: number;
  nombre: string;
  total: number;
}

/** Bloque D: ingresos por línea de negocio (Insumos/Con Sentido/Talleres). */
export interface ResumenIngresoTipo {
  slug: string;
  total: number;
}

/** Fila de la matriz del Bloque E: una línea de negocio (o la fila "total"),
 *  con su total por cada mes presente en `meses`. */
export interface ResumenVentasPorMesFila {
  slug: string;
  valores: Record<string, number>;
}

/** Bloque E: matriz de ventas por mes, histórico completo (no filtra por rango). */
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
