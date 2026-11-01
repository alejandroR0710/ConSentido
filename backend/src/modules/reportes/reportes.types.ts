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

/**
 * Reporte "Ventas" — detalle de ventas de mostrador (Con Sentido/Insumos/
 * Talleres) más los ingresos del alcance de negocio que no tienen línea de
 * producto propia (abonos de pedidos, ingresos manuales de Caja General...).
 * Ver reportes.repository.ts/reportes.service.ts.
 */

/** Filtros opcionales del reporte de Ventas, además de `desde`/`hasta`. */
export interface VentasFiltros {
  desde: string;
  hasta: string;
  metodo?: "efectivo" | "banco";
  /** Aceptado por compatibilidad con el filtro del Spec, pero sin efecto en
   *  la query: `con_sentido_ventas` no guarda ningún dato de cliente (venta
   *  de mostrador) — ver nota en reportes.service.ts::obtenerVentas. */
  cliente?: string;
  producto?: string;
}

/** Fila con detalle de producto — una línea de `con_sentido_venta_items` de
 *  una venta completada (Paso 1). */
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
  /** `facturas.numero`, o `null` si la venta todavía no tiene factura
   *  generada (ej. un carrito de mesa completado que nadie ha impreso). */
  consecutivo: string | null;
}

/** Fila sin detalle de producto — un ingreso de `movimientos_caja` que no
 *  corresponde a una venta ya cubierta por el Paso 1 (Paso 2). */
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

/** Vista agrupada por día del Spec: fecha + total de ese día. */
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

/**
 * Reporte "Ventas por tipo" — pivot diario de las 3 líneas de negocio
 * (Insumos/Con Sentido/Talleres), mismo universo de filas que el Bloque D
 * del Resumen (`ingresosPorTipo`) pero agrupado por día. Ver
 * reportes.repository.ts::getVentasPorTipoDiario / reportes.service.ts::obtenerVentasPorTipo.
 */

/** Una fila por día: total de cada línea de negocio + `total` (suma de las 3). */
export interface VentasPorTipoDiaFila {
  fecha: string;
  insumos: number;
  con_sentido: number;
  talleres: number;
  total: number;
}

/** Totales del rango completo por línea de negocio + `total` general — debe
 *  coincidir con `ingresosPorTipo`/`ingresos_total` del Bloque D del Resumen
 *  para el mismo rango (misma fuente de filas, agrupada distinto). */
export interface VentasPorTipoTotales {
  insumos: number;
  con_sentido: number;
  talleres: number;
  total: number;
}

/** % de participación de cada línea de negocio sobre `totales.total` del
 *  rango (escala 0-100, igual convención que `porcentaje` en el resto del
 *  backend — ej. `descuento_porcentaje`/`velas_producto_fragancias.porcentaje`). */
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
