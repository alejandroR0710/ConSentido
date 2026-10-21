import type { ReactNode } from "react";

interface ModalProps {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  maxWidth?: string;
  // "advertencia": para popups que exigen atención (algo bloquea una acción,
  // falta resolver algo) — borde y título en amber en vez del verde normal.
  tono?: "normal" | "advertencia";
  // Botón(es) extra en el header, a la izquierda de la ✕ (ej. "Minimizar")
  // — opcional, no afecta a los modales que no lo pasan.
  accionExtra?: ReactNode;
  // Panel adicional al costado del diálogo (no dentro de su área con
  // scroll) — para resúmenes/información de apoyo que no debe competir por
  // espacio con el formulario. En mobile, sin espacio horizontal, se apila
  // debajo del diálogo en vez de ir al costado.
  panelLateral?: ReactNode;
  // Ancho del panel lateral en pantallas sm+ (clase Tailwind, ej. "sm:w-70"
  // o "sm:w-[480px]") — por defecto un ancho angosto de resumen; un panel
  // lateral con un formulario completo (ej. otro "Registrar ingreso"
  // embebido) necesita bastante más.
  anchoPanelLateral?: string;
  // Segundo panel al costado, a la derecha de panelLateral (mismo criterio:
  // afuera del área con scroll del diálogo) — para un resumen/cobro que
  // combina lo de los dos anteriores. Las tres columnas van una al lado de
  // la otra en pantallas sm+ en el orden: diálogo, panelLateral,
  // panelResumen (ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md).
  // En mobile se apilan verticalmente, en ese mismo orden.
  panelResumen?: ReactNode;
  anchoPanelResumen?: string;
  // Las columnas visibles (diálogo + panelLateral si está + panelResumen si
  // está) se reparten el ancho disponible en partes iguales en vez de usar
  // maxWidth/anchoPanelLateral/anchoPanelResumen — 50/50 con dos, 33/33/33
  // con tres. Pedido puntual para el cobro de una mesa en Migao; el resto de
  // los modales de la app sigue con sus anchos fijos de siempre.
  columnasIguales?: boolean;
}

/**
 * Overlay genérico: bottom-sheet en mobile (se desliza desde abajo), diálogo
 * centrado en pantallas más grandes. Base de todos los popups de la app —
 * evita repetir el fondo oscuro + contenedor + botón de cerrar en cada uno.
 */
export function Modal({
  titulo,
  onCerrar,
  children,
  maxWidth = "sm:max-w-md",
  tono = "normal",
  accionExtra,
  panelLateral,
  anchoPanelLateral = "sm:w-70",
  panelResumen,
  anchoPanelResumen = "sm:w-80",
  columnasIguales = false,
}: ModalProps) {
  // flex-1 basis-0 min-w-0 en TODAS las columnas visibles reparte el ancho
  // disponible en partes iguales (2 columnas → 50/50, 3 → 33/33/33) sin
  // importar cuántas haya — es el comportamiento normal de flexbox cuando
  // todos los hijos comparten el mismo flex-grow/flex-basis.
  const anchoDialogo = columnasIguales ? "sm:min-w-0 sm:flex-1 sm:basis-0" : `sm:shrink-0 ${maxWidth}`;
  const anchoLateral = columnasIguales ? "sm:min-w-0 sm:flex-1 sm:basis-0" : `sm:shrink-0 ${anchoPanelLateral}`;
  const anchoResumen = columnasIguales ? "sm:min-w-0 sm:flex-1 sm:basis-0" : `sm:shrink-0 ${anchoPanelResumen}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-0 sm:items-start sm:p-4"
      onClick={onCerrar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`my-auto flex w-full flex-col gap-3 sm:max-h-[85vh] sm:w-auto sm:max-w-[95vw] sm:flex-row sm:items-stretch sm:justify-center ${
          columnasIguales ? "" : "sm:overflow-x-auto"
        }`}
      >
        <div
          className={`flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-brand-vanilla p-4 sm:rounded-2xl dark:bg-brand-green-900 ${
            tono === "advertencia" ? "border-t-4 border-amber-500 sm:border-4" : ""
          } ${anchoDialogo}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2
              className={`text-lg font-semibold ${
                tono === "advertencia"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-brand-green-700 dark:text-brand-vanilla"
              }`}
            >
              {tono === "advertencia" && <span aria-hidden>⚠️ </span>}
              {titulo}
            </h2>
            <div className="flex items-center gap-1">
              {accionExtra}
              <button
                onClick={onCerrar}
                aria-label="Cerrar"
                className="rounded-md px-2 py-1 text-xl text-brand-ink/60 hover:bg-brand-green-50 dark:text-brand-vanilla/60 dark:hover:bg-brand-green-700/40"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>

        {panelLateral && <div className={`w-full pb-4 ${anchoLateral} sm:overflow-y-auto sm:pb-0`}>{panelLateral}</div>}

        {panelResumen && <div className={`w-full pb-4 ${anchoResumen} sm:overflow-y-auto sm:pb-0`}>{panelResumen}</div>}
      </div>
    </div>
  );
}
