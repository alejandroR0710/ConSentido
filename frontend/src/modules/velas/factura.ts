import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { CalculoReceta } from "./api";

/** Desglose imprimible de una receta — reusa el tipo "cotización" del recibo
 *  (franja "NO es una factura de venta"): es exactamente el mensaje correcto
 *  para un papel de trabajo interno de costeo, y de paso sirve tal cual si
 *  Root quiere mostrárselo a un cliente como cotización real. El costo
 *  interno (para uso propio, no del cliente) queda en la nota, no en el total. */
export function recetaAReciboProps(nombre: string, calculo: CalculoReceta): Omit<ReciboImprimibleProps, "anchoMm"> {
  const items = [
    ...calculo.lineasCera.map((l) => ({ nombre: `Cera: ${l.nombre}`, cantidad: l.gramos, precioUnitario: l.valorGramo, subtotal: l.costo })),
    ...calculo.lineasFragancia.map((l) => ({
      nombre: `Fragancia: ${l.nombre} (${l.porcentaje}%)`,
      cantidad: l.gramos,
      precioUnitario: l.valorGramo,
      subtotal: l.costo,
    })),
    ...(calculo.lineaPabilo
      ? [{ nombre: calculo.lineaPabilo.nombre, cantidad: calculo.lineaPabilo.cm, precioUnitario: calculo.lineaPabilo.valorCm, subtotal: calculo.lineaPabilo.costo }]
      : []),
    ...calculo.lineasInsumo.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, precioUnitario: l.valorUnitario, subtotal: l.costo })),
  ];

  return {
    tipo: "cotizacion",
    folio: nombre,
    fecha: new Date().toISOString(),
    items,
    subtotal: calculo.costoBase,
    total: calculo.precioVenta,
    nota: `Costo total de producción: ${new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(calculo.costoTotal)} · Multiplicador aplicado: ×${calculo.multiplicadorAplicado}`,
  };
}
