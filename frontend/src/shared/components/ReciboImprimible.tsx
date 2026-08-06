import { useState } from "react";
import { formatMoney } from "../format/money";

export interface ReciboLinea {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface ReciboPago {
  metodoPago: string;
  monto: number;
}

export interface ReciboImprimibleProps {
  // Solo la copia que de verdad se imprime lleva "recibo-imprimible" (ver
  // ModalImprimir.tsx) — la vista previa dentro del modal no lo lleva, para
  // no tener dos elementos con el mismo id en el DOM al mismo tiempo.
  id?: string;
  tipo: "factura" | "cotizacion";
  folio: string;
  fecha: string;
  camposEncabezado?: { etiqueta: string; valor: string }[];
  items: ReciboLinea[];
  subtotal: number;
  descuentoPorcentaje?: number;
  descuentoMonto?: number;
  propina?: { monto: number; metodoPago: string } | null;
  pagos?: ReciboPago[];
  total: number;
  nota?: string | null;
  anchoMm: 58 | 80;
}

const NOMBRE_NEGOCIO = "Con Sentido — El Rinconcito del Migao";

function formatearFecha(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Layout del recibo imprimible (factura o cotización), compartido por ambos
 * flujos: mismo diseño, solo cambia la franja de estado y qué secciones
 * opcionales trae cada uno (pagos solo en factura, nota más común en
 * cotización). `id="recibo-imprimible"` es el gancho que usa print.css para
 * imprimir SOLO esto, ignorando el resto de la pantalla.
 */
export function ReciboImprimible({
  id,
  tipo,
  folio,
  fecha,
  camposEncabezado = [],
  items,
  subtotal,
  descuentoPorcentaje,
  descuentoMonto,
  propina,
  pagos,
  total,
  nota,
  anchoMm,
}: ReciboImprimibleProps) {
  const [logoError, setLogoError] = useState(false);
  const esCotizacion = tipo === "cotizacion";

  return (
    <div
      id={id}
      className={`mx-auto bg-white p-3 text-black ${anchoMm === 58 ? "w-[58mm]" : "w-[80mm]"}`}
      style={{ fontFamily: '"Courier New", monospace' }}
    >
      <div className="flex flex-col items-center gap-1 text-center">
        {!logoError ? (
          <img
            src="/logo-recibo.png"
            alt={NOMBRE_NEGOCIO}
            // La impresora térmica es monocromática: un logo a color con
            // sombras/degradados se "puntea" (dithering) y sale pixelado. Se
            // muestra ya en blanco y negro con más contraste (lo más parecido
            // a lo que realmente va a salir impreso) y más grande (más puntos
            // físicos para dibujar el trazo = menos bloques visibles).
            className="h-24 w-24 object-contain grayscale contrast-125"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="text-sm font-bold">Con Sentido</div>
        )}
        <div className="text-[11px] leading-tight">{NOMBRE_NEGOCIO}</div>
      </div>

      <div
        className={`my-2 rounded border-2 py-1 text-center text-[11px] font-bold ${
          esCotizacion ? "border-amber-600 text-amber-700" : "border-black text-black"
        }`}
      >
        {esCotizacion ? "COTIZACIÓN — NO es una factura de venta" : "FACTURA DE VENTA"}
      </div>

      <div className="mb-2 text-[11px]">
        <div>
          {esCotizacion ? "Cotización" : "Factura"} Nº {folio}
        </div>
        <div>Fecha: {formatearFecha(fecha)}</div>
        {camposEncabezado.map((c) => (
          <div key={c.etiqueta}>
            {c.etiqueta}: {c.valor}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-black" />

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-dashed border-black">
            <th className="py-1 text-left font-semibold">Producto</th>
            <th className="py-1 text-right font-semibold">Cant.</th>
            <th className="py-1 text-right font-semibold">Precio</th>
            <th className="py-1 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td className="py-0.5 pr-1 align-top">{item.nombre}</td>
              <td className="py-0.5 text-right align-top">{item.cantidad}</td>
              <td className="py-0.5 text-right align-top">{formatMoney(item.precioUnitario)}</td>
              <td className="py-0.5 text-right align-top">{formatMoney(item.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-black" />

      <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        {!!descuentoPorcentaje && descuentoPorcentaje > 0 && (
          <div className="flex justify-between">
            <span>Descuento ({descuentoPorcentaje}%)</span>
            <span>-{formatMoney(descuentoMonto ?? 0)}</span>
          </div>
        )}
        {propina && propina.monto > 0 && (
          <div className="flex justify-between">
            <span>Propina ({propina.metodoPago})</span>
            <span>{formatMoney(propina.monto)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(total)}</span>
        </div>
      </div>

      {pagos && pagos.length > 0 && (
        <div className="mt-2 border-t border-dashed border-black pt-1 text-[11px]">
          <div className="font-semibold">Pago{pagos.length > 1 ? "s" : ""}:</div>
          {pagos.map((p, idx) => (
            <div key={idx} className="flex justify-between capitalize">
              <span>
                {p.metodoPago}
                {pagos.length > 1 ? ` (parte ${idx + 1})` : ""}
              </span>
              <span>{formatMoney(p.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {nota && <div className="mt-2 text-[11px] italic">Nota: {nota}</div>}

      <div className="mt-3 text-center text-[10px]">
        {esCotizacion ? "Precios sujetos a cambio. Válida por 15 días." : "¡Gracias por tu compra!"}
      </div>
    </div>
  );
}
