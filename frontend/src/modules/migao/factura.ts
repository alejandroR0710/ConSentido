import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import { labelArea } from "./areas";
import type { EntregaPropina, FacturaOrden } from "./api";

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

/** Comprobante de entrega de propina a una persona del equipo, con espacio
 *  para firma de recibido — se imprime al repartir o se reimprime después
 *  desde el historial de entregas (el registro ya vive en
 *  migao_propinas_entregas, no hace falta guardar nada aparte). */
export function entregaPropinaAReciboProps(entrega: EntregaPropina): Omit<ReciboImprimibleProps, "anchoMm"> {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [
    { etiqueta: "Persona", valor: entrega.nombre_persona },
    { etiqueta: "Método", valor: entrega.metodo_pago === "efectivo" ? "Efectivo" : "Banco" },
  ];
  if (entrega.motivo) camposEncabezado.push({ etiqueta: "Motivo", valor: entrega.motivo });
  if (entrega.usuario_nombre) camposEncabezado.push({ etiqueta: "Registrado por", valor: entrega.usuario_nombre });

  const monto = Number(entrega.monto);
  return {
    tipo: "comprobante_propina",
    fecha: entrega.fecha_entrega,
    camposEncabezado,
    items: [{ nombre: "Propina entregada", cantidad: 1, precioUnitario: monto, subtotal: monto }],
    total: monto,
  };
}
