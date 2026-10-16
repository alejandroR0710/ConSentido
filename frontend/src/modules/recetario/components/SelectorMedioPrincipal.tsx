import type { ReactNode } from "react";

interface SelectorMedioPrincipalProps {
  medio: "imagen" | "video";
  onCambiarMedio: (medio: "imagen" | "video") => void;
  children: ReactNode;
}

const OPCIONES_MEDIO = [
  { valor: "imagen" as const, etiqueta: "🖼️ Imagen" },
  { valor: "video" as const, etiqueta: "🎬 Video" },
];

/** Selector del medio principal de una receta (imagen o video) — el
 *  selector y lo que haya debajo (elegir archivo, o el link de video) viven
 *  juntos en una sola tarjeta, en vez de verse como dos piezas sueltas. */
export function SelectorMedioPrincipal({ medio, onCambiarMedio, children }: SelectorMedioPrincipalProps) {
  return (
    <div className="mb-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
      <div className="mb-3 flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {OPCIONES_MEDIO.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => onCambiarMedio(op.valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              medio === op.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
