import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { cajaApi } from "../../caja/api";
import { facturaCajaAReciboProps } from "../../caja/factura";
import { conSentidoApi } from "../../con_sentido/api";
import { migaoApi } from "../api";
import { facturaAReciboProps } from "../factura";

// "orden"/"venta" son de Migao (una orden cerrada genera una venta);
// "venta_con_sentido" es el flujo de venta directa de Con Sentido;
// "venta_caja" es un ingreso manual registrado directo desde Caja General
// (ver caja.service.ts::registrarIngresoManual) — cada uno pega contra su
// propio endpoint de factura, pero todos terminan en el mismo modal de impresión.
type OrigenFactura =
  | { tipo: "orden"; id: string }
  | { tipo: "venta"; id: string }
  | { tipo: "venta_con_sentido"; id: string }
  | { tipo: "venta_caja"; id: string };

interface BotonFacturaProps {
  origen: OrigenFactura;
  className?: string;
  etiqueta?: string;
}

/** Botón reutilizable: trae la factura de una venta ya cobrada (se crea la
 *  primera vez que se pide, ver migao.service.ts::obtenerFacturaOrden /
 *  con_sentido.service.ts::obtenerFacturaVenta) y abre el modal de impresión
 *  — usado en cualquier historial que liste órdenes/ventas cerradas, sin
 *  importar de qué módulo del negocio vengan. */
export function BotonFactura({ origen, className, etiqueta = "Factura" }: BotonFacturaProps) {
  const [cargando, setCargando] = useState(false);
  const [recibo, setRecibo] = useState<ReturnType<typeof facturaAReciboProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setCargando(true);
    setError(null);
    try {
      if (origen.tipo === "venta_caja") {
        setRecibo(facturaCajaAReciboProps(await cajaApi.obtenerFacturaVenta(origen.id)));
        return;
      }
      const factura =
        origen.tipo === "orden"
          ? await migaoApi.obtenerFactura(origen.id)
          : origen.tipo === "venta"
            ? await migaoApi.obtenerFacturaPorVenta(origen.id)
            : await conSentidoApi.obtenerFactura(origen.id);
      setRecibo(facturaAReciboProps(factura));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar la factura");
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button
        onClick={abrir}
        disabled={cargando}
        className={
          className ??
          "rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        }
      >
        {cargando ? "..." : etiqueta}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {recibo && <ModalImprimir {...recibo} onCerrar={() => setRecibo(null)} />}
    </>
  );
}
