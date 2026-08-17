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

export interface ReciboEtiquetaMonto {
  etiqueta: string;
  monto: number;
}

export interface ReciboDetalleMovimiento {
  hora: string;
  concepto: string;
  metodoPago: string;
  tipo: "ingreso" | "egreso";
  monto: number;
  numeroFactura?: string | null;
}

export interface ReciboImprimibleProps {
  // Solo la copia que de verdad se imprime lleva "recibo-imprimible" (ver
  // ModalImprimir.tsx) — la vista previa dentro del modal no lo lleva, para
  // no tener dos elementos con el mismo id en el DOM al mismo tiempo.
  id?: string;
  // "movimiento": comprobante simple de un ingreso/egreso suelto de Caja
  // General (sin ítems, ej. un ingreso manual o un egreso) — ver `variante`.
  // "resumen": totalizado de un día o un turno (ver resumenIngresos/Egresos).
  // "comprobante_propina": vale de entrega de propina a una persona del
  // equipo, con espacio para que firme de recibido (ver HistorialPropinasPage).
  tipo: "factura" | "cotizacion" | "movimiento" | "resumen" | "comprobante_propina";
  // Solo aplica a tipo "movimiento": qué franja/color mostrar.
  variante?: "ingreso" | "egreso";
  folio?: string;
  fecha: string;
  camposEncabezado?: { etiqueta: string; valor: string }[];
  // factura / cotización / movimiento (movimiento usa una sola línea)
  items?: ReciboLinea[];
  subtotal?: number;
  descuentoPorcentaje?: number;
  descuentoMonto?: number;
  propina?: { monto: number; metodoPago: string } | null;
  pagos?: ReciboPago[];
  total?: number;
  nota?: string | null;
  // resumen de día/turno: listado detallado movimiento por movimiento +
  // desglose por área/categoría + balance
  movimientosDetalle?: ReciboDetalleMovimiento[];
  resumenIngresos?: ReciboEtiquetaMonto[];
  resumenEgresos?: ReciboEtiquetaMonto[];
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
 * Layout del recibo imprimible, compartido por los 4 documentos que puede
 * imprimir la app: factura, cotización, comprobante suelto de un movimiento
 * de Caja (ingreso/egreso sin ítems) y resumen totalizado de un día/turno.
 * Mismo encabezado (logo + franja de estado) y pie para los 4 — solo cambia
 * el cuerpo según `tipo`. `id="recibo-imprimible"` es el gancho que usa
 * print.css para imprimir SOLO esto, ignorando el resto de la pantalla.
 */
export function ReciboImprimible({
  id,
  tipo,
  variante,
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
  movimientosDetalle,
  resumenIngresos,
  resumenEgresos,
  anchoMm,
}: ReciboImprimibleProps) {
  const [logoError, setLogoError] = useState(false);

  const esCotizacion = tipo === "cotizacion";
  const esMovimiento = tipo === "movimiento";
  const esResumen = tipo === "resumen";
  const esComprobantePropina = tipo === "comprobante_propina";
  const esEgreso = esMovimiento && variante === "egreso";
  // Comparte el layout simple de "movimiento" (una sola línea, sin columnas
  // de cantidad/precio) — un comprobante de propina también es un solo monto.
  const esLineaUnica = esMovimiento || esComprobantePropina;

  const franjaTexto = esCotizacion
    ? "COTIZACIÓN — NO es una factura de venta"
    : esResumen
      ? "RESUMEN DE CAJA"
      : esComprobantePropina
        ? "COMPROBANTE DE ENTREGA DE PROPINA"
        : esMovimiento
          ? esEgreso
            ? "COMPROBANTE DE EGRESO"
            : "COMPROBANTE DE INGRESO"
          : "FACTURA DE VENTA";
  // Cotización: relleno sólido (no solo borde+texto de color) — un color
  // claro sobre blanco se convierte en un punteado casi invisible en la
  // impresora térmica (mismo problema que el peso de fuente, ver comentario
  // más abajo); un bloque negro sólido con texto blanco SIEMPRE imprime oscuro.
  const franjaClase = esCotizacion
    ? "border-black bg-black text-white"
    : esEgreso
      ? "border-red-600 text-red-700"
      : "border-black text-black";

  const tituloDocumento = esCotizacion
    ? "Cotización"
    : esComprobantePropina
      ? "Comprobante de propina"
      : esMovimiento
        ? "Comprobante"
        : esResumen
          ? null
          : "Factura";

  const totalIngresos = (resumenIngresos ?? []).reduce((acc, r) => acc + r.monto, 0);
  const totalEgresos = (resumenEgresos ?? []).reduce((acc, r) => acc + r.monto, 0);

  return (
    <div
      id={id}
      className={`mx-auto bg-white p-3 text-black ${anchoMm === 58 ? "w-[58mm]" : "w-[80mm]"}`}
      // La impresora térmica no tiene escala de grises: cualquier trazo fino
      // (peso "regular" de una fuente, letras chicas) se convierte en un
      // patrón de puntos (dithering) para simularlo, y eso es lo que se ve
      // "borroso". Semibold + una fuente sin serifas de trazo parejo aguanta
      // mucho mejor ese proceso — se imprime sólido en vez de punteado.
      style={{
        fontFamily: '"Consolas", "Courier New", monospace',
        fontWeight: 600,
        WebkitFontSmoothing: "none",
        textRendering: "optimizeLegibility",
      }}
    >
      <div className="flex flex-col items-center gap-1 text-center">
        {!logoError ? (
          <img
            // Versión vectorizada (trazo sólido en blanco y negro, sin
            // degradados) pensada para impresión térmica — no necesita
            // filtros de grayscale/contraste como el logo a color.
            src="/con_sentido_vectorizados.svg"
            alt={NOMBRE_NEGOCIO}
            // Es vector (SVG): agrandarlo no pierde nitidez — se sube bastante
            // para que ocupe el espacio en blanco que quedaba arriba del recibo.
            className="h-44 w-44 object-contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="text-lg font-bold">Con Sentido</div>
        )}
        <div className="text-[16px] leading-tight">{NOMBRE_NEGOCIO}</div>
      </div>

      <div className={`my-2 rounded border-2 py-1 text-center text-[16px] font-bold ${franjaClase}`}>
        {franjaTexto}
      </div>

      <div className="mb-2 text-[16px]">
        {tituloDocumento && (
          <div>
            {tituloDocumento}
            {folio ? ` Nº ${folio}` : ""}
          </div>
        )}
        <div>Fecha: {formatearFecha(fecha)}</div>
        {camposEncabezado.map((c) => (
          <div key={c.etiqueta}>
            {c.etiqueta}: {c.valor}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-black" />

      {esResumen ? (
        <div className="my-2 flex flex-col gap-3 text-[16px]">
          {movimientosDetalle && movimientosDetalle.length > 0 && (
            <div>
              <div className="mb-1 font-bold">Detalle de movimientos</div>
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-dashed border-black">
                    <th className="py-0.5 text-left font-semibold">Hora</th>
                    <th className="py-0.5 text-left font-semibold">Concepto</th>
                    <th className="py-0.5 text-right font-semibold">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientosDetalle.map((m, idx) => (
                    <tr key={idx}>
                      <td className="py-0.5 pr-1 align-top">{m.hora}</td>
                      <td className="py-0.5 pr-1 align-top">
                        {m.concepto}
                        <div className="text-[13px] font-normal capitalize">
                          {m.metodoPago}
                          {m.numeroFactura ? ` · ${m.numeroFactura}` : ""}
                        </div>
                      </td>
                      <td className="py-0.5 text-right align-top">
                        {m.tipo === "egreso" ? "-" : ""}
                        {formatMoney(m.monto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="mb-1 font-bold">Ingresos</div>
            {(resumenIngresos ?? []).length === 0 ? (
              <div className="text-[15px]">Sin ingresos.</div>
            ) : (
              (resumenIngresos ?? []).map((r) => (
                <div key={r.etiqueta} className="flex justify-between">
                  <span>{r.etiqueta}</span>
                  <span>{formatMoney(r.monto)}</span>
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-dashed border-black font-semibold">
              <span>Total ingresos</span>
              <span>{formatMoney(totalIngresos)}</span>
            </div>
          </div>

          <div>
            <div className="mb-1 font-bold">Egresos</div>
            {(resumenEgresos ?? []).length === 0 ? (
              <div className="text-[15px]">Sin egresos.</div>
            ) : (
              (resumenEgresos ?? []).map((r) => (
                <div key={r.etiqueta} className="flex justify-between">
                  <span>{r.etiqueta}</span>
                  <span>-{formatMoney(r.monto)}</span>
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-dashed border-black font-semibold">
              <span>Total egresos</span>
              <span>-{formatMoney(totalEgresos)}</span>
            </div>
          </div>
        </div>
      ) : (
        <table className="w-full text-[16px]">
          <thead>
            <tr className="border-b border-dashed border-black">
              <th className="py-1 text-left font-semibold">{esLineaUnica ? "Concepto" : "Producto"}</th>
              {!esLineaUnica && (
                <>
                  <th className="py-1 text-right font-semibold">Cant.</th>
                  <th className="py-1 text-right font-semibold">Precio</th>
                </>
              )}
              <th className="py-1 text-right font-semibold">{esLineaUnica ? "Monto" : "Total"}</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((item, idx) => (
              <tr key={idx}>
                <td className="py-0.5 pr-1 align-top">{item.nombre}</td>
                {!esLineaUnica && (
                  <>
                    <td className="py-0.5 text-right align-top">{item.cantidad}</td>
                    <td className="py-0.5 text-right align-top">{formatMoney(item.precioUnitario)}</td>
                  </>
                )}
                <td className="py-0.5 text-right align-top">{formatMoney(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-dashed border-black" />

      <div className="mt-1 flex flex-col gap-0.5 text-[16px]">
        {esResumen ? (
          <div className="flex justify-between text-lg font-bold">
            <span>BALANCE</span>
            <span>{formatMoney(totalIngresos - totalEgresos)}</span>
          </div>
        ) : (
          <>
            {!esLineaUnica && (
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatMoney(subtotal ?? 0)}</span>
              </div>
            )}
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
            <div className="flex justify-between text-lg font-bold">
              <span>TOTAL</span>
              {/* La propina es plata aparte del mesero (nunca entra a `total`,
                  que es lo que de verdad ingresó a Caja General) — pero en el
                  papel impreso el cliente espera ver cuánto entregó en total,
                  cuenta + propina incluida. */}
              <span>{formatMoney((total ?? 0) + (propina?.monto ?? 0))}</span>
            </div>
          </>
        )}
      </div>

      {pagos && pagos.length > 0 && (
        <div className="mt-2 border-t border-dashed border-black pt-1 text-[16px]">
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

      {nota && <div className="mt-2 text-[16px] italic">Nota: {nota}</div>}

      {esComprobantePropina && (
        <div className="mt-6 text-[16px]">
          <div className="border-t border-black pt-1 text-center">Firma de quien recibe</div>
          <div className="mt-1 text-center text-[13px]">C.C.: _______________________</div>
        </div>
      )}

      <div className="mt-3 text-center text-[15px]">
        {esCotizacion
          ? "Precios sujetos a cambio. Válida por 15 días."
          : esMovimiento || esResumen || esComprobantePropina
            ? "Documento interno — no es una factura de venta."
            : "¡Gracias por tu compra!"}
      </div>
    </div>
  );
}
