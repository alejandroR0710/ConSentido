import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import { labelArea } from "./areas";
import type { FacturaOrden } from "./api";

/** Traduce la factura tal como la devuelve el backend al formato genérico
 *  que espera `ReciboImprimible` — usado tanto al cobrar (MigaoPage) como al
 *  reimprimir desde cualquier historial. */
export function facturaAReciboProps(factura: FacturaOrden): Omit<ReciboImprimibleProps, "anchoMm"> {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [];
  if (factura.mesaNumero) {
    camposEncabezado.push({
      etiqueta: "Mesa",
      valor: factura.mesaPiso ? `${factura.mesaNumero} (${labelArea(factura.mesaPiso)})` : factura.mesaNumero,
    });
  }
  if (factura.meseroNombre) camposEncabezado.push({ etiqueta: "Mesero", valor: factura.meseroNombre });
  if (factura.comensalNumero != null) camposEncabezado.push({ etiqueta: "Comensal", valor: `#${factura.comensalNumero}` });

  return {
    tipo: "factura",
    folio: factura.numeroFactura,
    fecha: factura.fecha,
    camposEncabezado,
    items: factura.items.map((item) => ({
      nombre: item.productoNombre,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      subtotal: item.subtotal,
    })),
    subtotal: factura.subtotal,
    descuentoPorcentaje: factura.descuentoPorcentaje,
    descuentoMonto: factura.descuentoMonto,
    propina: factura.propina ? { monto: factura.propina.monto, metodoPago: factura.propina.metodoPago } : null,
    pagos: factura.pagos.map((pago) => ({ metodoPago: pago.metodoPago, monto: pago.monto })),
    total: factura.total,
  };
}
