import type { ReactNode } from "react";

interface ModalProps {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  maxWidth?: string;
  // "advertencia": para popups que exigen atención (algo bloquea una acción,
  // falta resolver algo) — borde y título en amber en vez del verde normal.
  tono?: "normal" | "advertencia";
}

/**
 * Overlay genérico: bottom-sheet en mobile (se desliza desde abajo), diálogo
 * centrado en pantallas más grandes. Base de todos los popups de la app —
 * evita repetir el fondo oscuro + contenedor + botón de cerrar en cada uno.
 */
export function Modal({ titulo, onCerrar, children, maxWidth = "sm:max-w-md", tono = "normal" }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onCerrar}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-brand-vanilla p-4 sm:rounded-2xl dark:bg-brand-green-900 ${
          tono === "advertencia" ? "border-t-4 border-amber-500 sm:border-4" : ""
        } ${maxWidth}`}
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
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-xl text-brand-ink/60 hover:bg-brand-green-50 dark:text-brand-vanilla/60 dark:hover:bg-brand-green-700/40"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
