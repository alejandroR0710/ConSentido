import type { ReciboEtiquetaMonto, ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { MovimientoCaja } from "./api";
import { LABEL_POR_MODULO_SLUG } from "./moduloOrigen";

/** Comprobante suelto de un movimiento de Caja que NO es una venta (egreso,
 *  ingreso manual, etc.) — se arma con lo que ya trae el movimiento, sin
 *  ninguna llamada a la API (a diferencia de la factura de una venta, acá no
 *  hay ítems que reconstruir). */
export function movimientoAReciboProps(m: MovimientoCaja): Omit<ReciboImprimibleProps, "anchoMm"> {
  const concepto =
    m.tipo === "ingreso"
      ? (m.modulo_origen_slug ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug) : "Ingreso")
      : (m.categoria_gasto_nombre ?? "Egreso");

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

/** Totalizado imprimible de un día o un turno — desglosado por área/categoría
 *  (mismo `[etiqueta, monto][]` que ya calcula `agruparPorEtiqueta` en las
 *  pantallas de Caja), con el balance final. */
export function resumenAReciboProps(params: {
  fecha: string;
  camposEncabezado: { etiqueta: string; valor: string }[];
  ingresos: ReciboEtiquetaMonto[];
  egresos: ReciboEtiquetaMonto[];
}): Omit<ReciboImprimibleProps, "anchoMm"> {
  return {
    tipo: "resumen",
    fecha: params.fecha,
    camposEncabezado: params.camposEncabezado,
    resumenIngresos: params.ingresos,
    resumenEgresos: params.egresos,
  };
}
