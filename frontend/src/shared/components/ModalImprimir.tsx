import { useState } from "react";
import { Modal } from "./Modal";
import { ReciboImprimible, type ReciboImprimibleProps } from "./ReciboImprimible";

const CLAVE_ANCHO = "recibo-ancho-mm";

function obtenerAnchoGuardado(): 58 | 80 {
  return window.localStorage.getItem(CLAVE_ANCHO) === "58" ? 58 : 80;
}

type ModalImprimirProps = Omit<ReciboImprimibleProps, "anchoMm"> & { onCerrar: () => void };

/**
 * Modal reutilizable para imprimir una factura o una cotización: muestra la
 * vista previa exacta del recibo y un botón "Imprimir" que abre el diálogo
 * del navegador contra la impresora térmica (instalada como impresora del
 * sistema — ver shared/print/print.css). El ancho 58mm/80mm se recuerda en
 * localStorage para no tener que elegirlo cada vez.
 */
export function ModalImprimir({ onCerrar, ...recibo }: ModalImprimirProps) {
  const [anchoMm, setAnchoMm] = useState<58 | 80>(obtenerAnchoGuardado);

  function cambiarAncho(valor: 58 | 80) {
    setAnchoMm(valor);
    window.localStorage.setItem(CLAVE_ANCHO, String(valor));
  }

  return (
    <Modal titulo={recibo.tipo === "cotizacion" ? "Cotización" : "Factura"} onCerrar={onCerrar} maxWidth="sm:max-w-sm">
      <div className="mb-3 flex items-center justify-center gap-2">
        <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Ancho de papel:</span>
        {([58, 80] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => cambiarAncho(valor)}
            className={`rounded-md border px-2 py-1 text-xs ${
              anchoMm === valor
                ? "border-brand-green-700 bg-brand-green-100 dark:bg-brand-green-700/40"
                : "border-brand-vanilla-dark dark:border-brand-green-700"
            }`}
          >
            {valor}mm
          </button>
        ))}
      </div>

      <div className="max-h-[55vh] overflow-y-auto rounded-md border border-brand-vanilla-dark dark:border-brand-green-700">
        <ReciboImprimible {...recibo} anchoMm={anchoMm} />
      </div>

      <button
        onClick={() => window.print()}
        className="mt-3 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600"
      >
        🖨️ Imprimir
      </button>
    </Modal>
  );
}
