import type { ReciboImprimibleProps } from "../../shared/components/ReciboImprimible";
import type { Vale } from "./api";

const LABEL_FUENTE: Record<string, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

/** Traduce un vale (o una deuda) al formato genérico que espera
 *  `ReciboImprimible` — mismo patrón que `migao/factura.ts::entregaPropinaAReciboProps`
 *  (también de una sola línea, con espacio de firma). */
export function valeAReciboProps(vale: Vale): Omit<ReciboImprimibleProps, "anchoMm"> {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [
    { etiqueta: vale.tipo === "deuda" ? "Quién debe" : "Pagado a", valor: vale.pagado_a },
  ];
  if (vale.destinatario_documento) camposEncabezado.push({ etiqueta: "Documento", valor: vale.destinatario_documento });
  camposEncabezado.push({ etiqueta: "Fuente", valor: vale.fuente ? LABEL_FUENTE[vale.fuente] : "Sin préstamo inicial" });
  if (vale.tipo === "deuda") {
    camposEncabezado.push({ etiqueta: "Estado", valor: vale.cobrado_en ? "Cobrada" : "Pendiente de cobro" });
  }
  if (vale.creado_por_nombre) camposEncabezado.push({ etiqueta: "Registrado por", valor: vale.creado_por_nombre });

  const montoEfectivo = Number(vale.monto_efectivo);
  const montoBanco = Number(vale.monto_banco);
  const total = vale.fuente ? montoEfectivo + montoBanco : Number(vale.monto_adeudado ?? 0);

  return {
    tipo: "vale",
    variante: vale.tipo === "deuda" ? "deuda" : undefined,
    folio: vale.numero,
    fecha: vale.created_at,
    camposEncabezado,
    items: [{ nombre: vale.concepto, cantidad: 1, precioUnitario: total, subtotal: total }],
    total,
    pagos: [
      ...(montoEfectivo > 0 ? [{ metodoPago: "efectivo", monto: montoEfectivo }] : []),
      ...(montoBanco > 0 ? [{ metodoPago: "banco", monto: montoBanco }] : []),
    ],
    // Un vale anulado tiene que seguir siendo imprimible (sirve de constancia
    // de que se anuló), pero NUNCA debe salir en blanco como si fuera válido
    // para firmar — alguien podría reimprimirlo y hacerlo firmar de nuevo
    // como si el pago/deuda siguiera vigente.
    nota: vale.anulado_en ? `⚠ VALE ANULADO el ${new Date(vale.anulado_en).toLocaleString("es")} — este documento ya NO es válido.` : null,
  };
}
