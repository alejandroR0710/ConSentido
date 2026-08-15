import type { ReciboDetalleMovimiento, ReciboEtiquetaMonto, ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { MovimientoCaja } from "./api";
import { LABEL_POR_MODULO_SLUG } from "./moduloOrigen";

/** Mismo criterio de nombre en los dos recibos que muestran un movimiento
 *  (comprobante suelto y detalle dentro del resumen): el origen para
 *  ingresos, la categoría de gasto para egresos. */
function conceptoDeMovimiento(m: MovimientoCaja): string {
  return m.tipo === "ingreso"
    ? (m.modulo_origen_slug ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug) : "Ingreso")
    : (m.categoria_gasto_nombre ?? "Egreso");
}

/** Comprobante suelto de un movimiento de Caja que NO es una venta (egreso,
 *  ingreso manual, etc.) — se arma con lo que ya trae el movimiento, sin
 *  ninguna llamada a la API (a diferencia de la factura de una venta, acá no
 *  hay ítems que reconstruir). */
export function movimientoAReciboProps(m: MovimientoCaja): Omit<ReciboImprimibleProps, "anchoMm"> {
  const concepto = conceptoDeMovimiento(m);

  const camposEncabezado: { etiqueta: string; valor: string }[] = [];
  if (m.motivo) camposEncabezado.push({ etiqueta: "Motivo", valor: m.motivo });
  if (m.proveedor_nombre) camposEncabezado.push({ etiqueta: "Proveedor", valor: m.proveedor_nombre });
  camposEncabezado.push({ etiqueta: "Método", valor: m.metodo_pago });

  const monto = Number(m.monto);
  return {
    tipo: "movimiento",
    variante: m.tipo,
    folio: String(m.id),
    fecha: m.created_at,
    camposEncabezado,
    items: [{ nombre: concepto, cantidad: 1, precioUnitario: monto, subtotal: monto }],
    total: monto,
  };
}

/** Totalizado imprimible de un día o un turno — listado detallado movimiento
 *  por movimiento (hora, concepto, método, factura si aplica) seguido del
 *  desglose por área/categoría (mismo `[etiqueta, monto][]` que ya calcula
 *  `agruparPorEtiqueta` en las pantallas de Caja) y el balance final. */
export function resumenAReciboProps(params: {
  fecha: string;
  camposEncabezado: { etiqueta: string; valor: string }[];
  movimientos: MovimientoCaja[];
  ingresos: ReciboEtiquetaMonto[];
  egresos: ReciboEtiquetaMonto[];
}): Omit<ReciboImprimibleProps, "anchoMm"> {
  const movimientosOrdenados = [...params.movimientos].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const movimientosDetalle: ReciboDetalleMovimiento[] = movimientosOrdenados.map((m) => ({
    hora: new Date(m.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }),
    concepto: conceptoDeMovimiento(m),
    metodoPago: m.metodo_pago,
    tipo: m.tipo,
    monto: Number(m.monto),
    numeroFactura: m.numero_factura,
  }));

  return {
    tipo: "resumen",
    fecha: params.fecha,
    camposEncabezado: params.camposEncabezado,
    movimientosDetalle,
    resumenIngresos: params.ingresos,
    resumenEgresos: params.egresos,
  };
}
