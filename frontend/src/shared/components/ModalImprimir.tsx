import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import { ReciboImprimible, type ReciboImprimibleProps } from "./ReciboImprimible";

const CLAVE_ANCHO = "recibo-ancho-mm";

const TITULO_POR_TIPO: Record<ReciboImprimibleProps["tipo"], string> = {
  factura: "Factura",
  cotizacion: "Cotización",
  movimiento: "Comprobante",
  resumen: "Resumen de caja",
};

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
  // El logo (SVG) tarda un poquito en llegar la primera vez de la sesión —
  // si se imprimía apenas se abría el modal (como antes), a veces la
  // impresión salía disparada ANTES de que la imagen terminara de pintarse
  // y quedaba sin logo. Se espera a que la copia que de verdad se imprime
  // avise que ya cargó (o falló) antes de mandar a imprimir.
  const [logoListo, setLogoListo] = useState(false);

  // Salta directo al diálogo de impresión del navegador al abrir — sin este
  // paso, había que ver nuestra vista previa Y LUEGO la del navegador, dos
  // pantallas para lo mismo. El navegador siempre va a pedir su propia
  // confirmación antes de imprimir (ninguna web puede saltársela por
  // seguridad), así que este modal queda de respaldo debajo por si hay que
  // reimprimir o cambiar el ancho de papel.
  useEffect(() => {
    if (!logoListo) return;
    window.print();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoListo]);

  // Red de seguridad: si por lo que sea el logo nunca dispara onLoad/onError
  // (ej. algún caso raro de caché), no dejar al cajero esperando para siempre.
  useEffect(() => {
    const timeout = setTimeout(() => setLogoListo(true), 1500);
    return () => clearTimeout(timeout);
  }, []);

  function cambiarAncho(valor: 58 | 80) {
    setAnchoMm(valor);
    window.localStorage.setItem(CLAVE_ANCHO, String(valor));
  }

  return (
    <Modal titulo={TITULO_POR_TIPO[recibo.tipo]} onCerrar={onCerrar} maxWidth="sm:max-w-sm">
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
        {/* Vista previa: sin id, para no duplicar "recibo-imprimible" en el DOM. */}
        <ReciboImprimible {...recibo} anchoMm={anchoMm} />
      </div>

      <button
        onClick={() => window.print()}
        className="mt-3 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600"
      >
        🖨️ Imprimir
      </button>

      {/*
       * Copia real que se imprime, aparte de la vista previa de arriba: se
       * "teleporta" (portal) directo a <body>, fuera del contenedor del modal
       * (que es `position: fixed`). Chrome repite en CADA página impresa
       * cualquier elemento que cuelgue de un ancestro `position: fixed` — por
       * eso antes salían 4 copias seguidas del mismo recibo en una sola tira.
       * Oculta en pantalla (`hidden`), visible solo al imprimir (`print:block`).
       */}
      {createPortal(
        <div className="hidden print:block">
          {/* Alto "auto": la impresora térmica es un rollo continuo, no una
              hoja de tamaño fijo — sin esto el navegador paginaba a una
              altura estándar (ej. carta) y, si el recibo era más largo,
              partía el contenido en una "página 2" que repetía encabezado
              y título de la tabla (comportamiento normal del navegador con
              <thead> al paginar). Ancho dinámico porque el cajero puede
              cambiarlo (58mm/80mm) sin recargar. */}
          <style>{`@page { size: ${anchoMm}mm auto; margin: 0; }`}</style>
          <ReciboImprimible
            {...recibo}
            anchoMm={anchoMm}
            id="recibo-imprimible"
            onLogoSettled={() => setLogoListo(true)}
          />
        </div>,
        document.body,
      )}
    </Modal>
  );
}
