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

/**
 * Reporte "Gastos" — detalle de egresos del alcance de negocio completo (las
 * 5 slugs, no solo las 3 líneas de producto), ranking de proveedores (top
 * 10) y gastos por categoría (reusa `ResumenGastoCategoria`/
 * `getGastosPorCategoria` de Task 2 para el gráfico de este reporte). Ver
 * reportes.repository.ts/reportes.service.ts.
 */

/** Filtros opcionales del reporte de Gastos, además de `desde`/`hasta`. */
export interface GastosFiltros {
  desde: string;
  hasta: string;
  categoriaId?: number;
  proveedorId?: string;
  metodo?: "efectivo" | "banco";
}

/** Fila de detalle — un egreso de `movimientos_caja`. Nunca trae `cantidad`/
 *  `costo_unitario`: ese desglose por línea no existe en el modelo actual
 *  (Spec, Brecha #3) — un egreso es un monto total con `motivo` en texto
 *  libre, no una lista de ítems. */
export interface GastoFila {
  id: string;
  fecha: string;
  /** `null` si el egreso no tiene proveedor asociado (ej. nómina). */
  proveedor: string | null;
  categoria: string;
  motivo: string | null;
  monto: number;
  /** `movimientos_caja.metodo_pago` solo admite 'efectivo'/'banco' (CHECK
   *  constraint) — "préstamo" no es un valor real en este sistema (Spec,
   *  Brecha #2), nunca aparece aquí. */
  metodo_pago: "efectivo" | "banco";
}

/** Fila del ranking de proveedores (top 10 por gasto total del rango). */
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
  /** Mismo shape que `ResumenGastoCategoria` del Resumen (Bloque C) — reusa
   *  `getGastosPorCategoria`, no duplica la query. */
  gastosPorCategoria: ResumenGastoCategoria[];
  totales: GastosTotalesReporte;
}

/**
 * Reporte "Cierre de caja diario" — ÚNICA excepción de alcance de todo el
 * módulo: lee `movimientos_caja`/`turnos_caja` SIN filtrar por
 * `modulo_origen_id` (Global Constraints/Spec) — es la caja física real y
 * única del POS completo, Migao incluido, no una vista del negocio Con
 * Sentido. Ver reportes.repository.ts/reportes.service.ts.
 */

/** Una fila por día del mes (incluye días sin ningún movimiento, con los 4
 *  montos de origen en 0) más la fila `TOTAL` (misma forma, ver
 *  `CierreCajaReporte.total`). */
export interface CierreCajaFila {
  /** `YYYY-MM-DD`, o literal `"TOTAL"` para la fila de cierre. */
  fecha: string;
  venta_efectivo: number;
  venta_banco: number;
  /** = `venta_efectivo + venta_banco` de ese día (columna "venta del día"
   *  del Excel original, distinta del desglose por método). */
  venta_dia: number;
  gastos_efectivo: number;
  gastos_banco: number;
  /** Saldo corrido de efectivo: `efectivo` del día anterior + venta − gastos
   *  de efectivo de este día (arranca desde `saldo_inicial`, NUNCA desde 0 —
   *  Review Focus). */
  efectivo: number;
  /** Mismo saldo corrido, lado banco. */
  banco: number;
  /** = `efectivo + banco` de este mismo renglón (no una suma de otra
   *  columna). */
  total_dinero: number;
  /** Nombre(s) del/los cajero(s) cuyo turno abrió ese día calendario,
   *  separados por coma si hubo más de uno (cambio de turno); `"—"` si
   *  ningún turno abrió ese día. En la fila `TOTAL` siempre `"—"` (no hay un
   *  único responsable del mes completo). */
  notas_responsable: string;
}

export interface CierreCajaSaldoInicial {
  efectivo: number;
  banco: number;
}

export interface CierreCajaReporte {
  mes: string;
  /** `monto_inicial_efectivo`/`monto_inicial_banco` del turno más reciente
   *  abierto en o antes del mes seleccionado — semilla del saldo corrido del
   *  día 1. `null` (dato no disponible, NUNCA `0`) si no existe ningún turno
   *  registrado hasta ese mes — Review Focus/Spec: "0" significaría
   *  "sabemos que la caja abrió vacía", que es un dato distinto de "no
   *  sabemos con cuánto abrió". */
  saldo_inicial: CierreCajaSaldoInicial | null;
  /** Un renglón por cada día calendario del mes, en orden — nunca se omite
   *  un día sin movimiento (Spec: "incluye días sin movimiento en 0"). */
  dias: CierreCajaFila[];
  /** Fila de cierre del mes completo: los 5 montos de movimiento (incluido
   *  `venta_dia`) son la SUMA de los `dias` (los 28/29/30/31 completos,
   *  incluido el último — anti-goal del Excel original); `efectivo`/`banco`/
   *  `total_dinero` son el saldo corrido del ÚLTIMO día (es un saldo, no una
   *  suma de saldos). Se expone separado de `dias` (mismo patrón que
   *  `totales` en `GastosReporte`/`VentasReporte`), no como último elemento
   *  del array — el consumidor decide si lo renderiza como última fila de
   *  la tabla. */
  total: CierreCajaFila;
}

/**
 * Reporte "Préstamos" — basado en `vales`, tabla independiente de
 * `movimientos_caja` (sin concepto de módulo/alcance de negocio: un vale no
 * está etiquetado por área — ver reportes.repository.ts::getVales). SIN
 * filtro de fecha obligatorio (Spec: selector de destinatario, no de
 * período) — solo `destinatarioUsuarioId` es un filtro real hoy.
 */

/** Filtros del reporte de Préstamos — sin rango obligatorio. */
export interface PrestamosFiltros {
  destinatarioUsuarioId?: string;
}

/**
 * Fila — un vale no anulado, con `monto`/`estado`/`fecha_resolucion`
 * derivados (ver reportes.service.ts::obtenerPrestamos):
 * - `monto` depende de `fuente`, NO de `tipo`:
 *   `monto = fuente ? monto_efectivo + monto_banco : monto_adeudado`.
 * - `tipo` decide qué columna de fecha se usa para `fecha_resolucion` y qué
 *   etiquetas de `estado` aplican:
 *   - `tipo='deuda'`: resuelta cuando `cobrado_en`.
 *   - `tipo='pago'`: resuelto cuando `repuesto_en`.
 * Las etiquetas de `estado` son intencionalmente distintas por tipo
 * ("Cobrado"/"Pendiente de cobro" vs. "Repuesto"/"Pendiente de reposición")
 * — son dos obligaciones distintas, no una sola genérica.
 */
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
  /** Suma de `monto` de las filas sin resolver (`fecha_resolucion === null`). */
  total_pendiente: number;
  /** Suma de `monto` de las filas resueltas (`fecha_resolucion !== null`). */
  total_resuelto: number;
}

export interface PrestamosReporte {
  filas: PrestamoFila[];
  totales: PrestamosTotales;
}
