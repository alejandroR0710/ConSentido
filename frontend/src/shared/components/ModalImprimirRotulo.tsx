import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";
import { RotuloEnvio, type RotuloEnvioProps } from "./RotuloEnvio";

// Mismo ancho de papel que ya elige el cajero para facturas (ModalImprimir.tsx)
// — es la misma impresora térmica, no hace sentido pedirlo dos veces.
const CLAVE_ANCHO = "recibo-ancho-mm";
const LARGO_ETIQUETA_MM = 100;

function obtenerAnchoGuardado(): 58 | 80 {
  return window.localStorage.getItem(CLAVE_ANCHO) === "58" ? 58 : 80;
}

type ModalImprimirRotuloProps = Omit<RotuloEnvioProps, "anchoMm" | "largoMm" | "id"> & { onCerrar: () => void };

/**
 * Rótulo de envío para pegar en la caja — mismo patrón que ModalImprimir.tsx
 * (vista previa + portal con la copia real que se imprime), pero la copia
 * que se imprime va ROTADA 90°: la impresora térmica es angosta (58/80mm de
 * ANCHO, largo continuo), así que para que el rótulo salga "horizontal" de
 * verdad — se lea de lado a lado al pegarlo en la caja, no de arriba hacia
 * abajo como un recibo — el contenido se gira dentro de una página del
 * mismo ancho que el papel (anchoMm) pero de largo LARGO_ETIQUETA_MM. La
 * vista previa en pantalla se muestra SIN rotar (en su orientación final),
 * para que se vea en el modal igual a como queda ya pegado en la caja.
 *
 * Si al imprimir sale al revés o espejado, cambiar `rotate(90deg)` por
 * `rotate(-90deg)` más abajo — depende de cómo cada impresora/driver orienta
 * el papel, no se puede saber sin probarlo en la impresora real.
 */
export function ModalImprimirRotulo({ onCerrar, ...rotulo }: ModalImprimirRotuloProps) {
  const [anchoMm] = useState<58 | 80>(obtenerAnchoGuardado);

  return (
    <Modal titulo="Rótulo de envío" onCerrar={onCerrar} maxWidth="sm:max-w-sm">
      <div className="mb-3 flex justify-center overflow-x-auto rounded-md border border-brand-vanilla-dark bg-brand-vanilla-dark/10 p-2 dark:border-brand-green-700">
        <RotuloEnvio {...rotulo} anchoMm={anchoMm} largoMm={LARGO_ETIQUETA_MM} />
      </div>

      <button
        onClick={() => window.print()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600"
      >
        🖨️ Imprimir rótulo
      </button>

      {createPortal(
        <div className="hidden print:block">
          <style>{`@page { size: ${anchoMm}mm ${LARGO_ETIQUETA_MM}mm; margin: 0; }`}</style>
          <div style={{ width: `${anchoMm}mm`, height: `${LARGO_ETIQUETA_MM}mm`, position: "relative", overflow: "hidden" }}>
            <div
              style={{
                width: `${LARGO_ETIQUETA_MM}mm`,
                height: `${anchoMm}mm`,
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%) rotate(90deg)",
              }}
            >
              <RotuloEnvio {...rotulo} anchoMm={anchoMm} largoMm={LARGO_ETIQUETA_MM} id="rotulo-imprimible" />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Modal>
  );
}
