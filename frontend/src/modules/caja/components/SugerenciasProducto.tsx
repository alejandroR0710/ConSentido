import { formatMoney } from "../../../shared/format/money";
import type { ProductoConSentido } from "../../con_sentido/api";

interface SugerenciasProductoProps {
  productos: ProductoConSentido[];
  texto: string;
  onSeleccionar: (producto: ProductoConSentido) => void;
}

const MAX_SUGERENCIAS = 6;

/**
 * Dropdown de sugerencias bajo el input "Producto o servicio" de un ingreso
 * manual — filtra el catálogo de Con Sentido por nombre o SKU a medida que
 * se escribe. Elegir una sugerencia precarga nombre+precio y deja el
 * productoId enganchado (ver IngresoModal.tsx), que es lo que el backend usa
 * para descontar stock y avisar al e-commerce. Si no se elige ninguna, el
 * ítem queda como texto libre de siempre, sin tocar inventario.
 */
export function SugerenciasProducto({ productos, texto, onSeleccionar }: SugerenciasProductoProps) {
  const termino = texto.trim().toLowerCase();
  if (termino.length === 0) return null;

  const coincidencias = productos
    .filter((p) => p.nombre.toLowerCase().includes(termino) || p.sku?.toLowerCase().includes(termino))
    .slice(0, MAX_SUGERENCIAS);

  if (coincidencias.length === 0) return null;

  return (
    <div
      // onMouseDown (no onClick) para que dispare ANTES del onBlur del input
      // — si no, el blur cierra el dropdown antes de que el click lo alcance.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-brand-vanilla-dark bg-white shadow-lg dark:border-brand-green-700 dark:bg-brand-green-900"
    >
      {coincidencias.map((p) => (
        <button
          type="button"
          key={p.id}
          onClick={() => onSeleccionar(p)}
          className="flex w-full items-center gap-2 border-b border-brand-vanilla-dark/50 px-2 py-1.5 text-left last:border-b-0 hover:bg-brand-green-50 dark:border-brand-green-700/50 dark:hover:bg-brand-green-700/40"
        >
          {p.imagen_url ? (
            <img src={p.imagen_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-vanilla text-xs text-brand-ink/40 dark:bg-brand-green-700/40 dark:text-brand-vanilla/40">
              🛍️
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-brand-ink dark:text-brand-vanilla">
              {p.nombre}
            </span>
            <span className="block text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
              {p.sku ? `SKU ${p.sku}` : "Sin SKU"} · Stock {p.stock}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
            {formatMoney(p.precio)}
          </span>
        </button>
      ))}
    </div>
  );
}
