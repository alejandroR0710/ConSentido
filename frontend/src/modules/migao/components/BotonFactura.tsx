import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { migaoApi } from "../api";
import { facturaAReciboProps } from "../factura";

interface BotonFacturaProps {
  ordenId: string;
  className?: string;
  etiqueta?: string;
}

/** Botón reutilizable: trae la factura de una orden ya cobrada (se crea la
 *  primera vez que se pide, ver migao.service.ts::obtenerFacturaOrden) y abre
 *  el modal de impresión — usado en cualquier historial que liste órdenes cerradas. */
export function BotonFactura({ ordenId, className, etiqueta = "Factura" }: BotonFacturaProps) {
  const [cargando, setCargando] = useState(false);
  const [recibo, setRecibo] = useState<ReturnType<typeof facturaAReciboProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setCargando(true);
    setError(null);
    try {
      const factura = await migaoApi.obtenerFactura(ordenId);
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
