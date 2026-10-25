import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "../../../shared/format/money";
import type { ProductoConSentido } from "../../con_sentido/api";
import { textoMayorista } from "../../con_sentido/mayorista";

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
 *
 * La lista se dibuja en un portal (document.body) con posición fija, anclada
 * bajo el input: antes iba `absolute` dentro del formulario y el contenedor
 * con scroll del cobro de la mesa ("Agregar productos de la tienda") la
 * recortaba y obligaba a desplazarse para ver las opciones (hallazgo real
 * 2026-10-25). Si no cabe abajo, se abre hacia arriba.
 */
const MARGEN = 8;
const ALTO_MINIMO = 160;

type Posicion = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export function SugerenciasProducto({ productos, texto, onSeleccionar }: SugerenciasProductoProps) {
  const [imagenAmpliada, setImagenAmpliada] = useState<{ url: string; nombre: string } | null>(null);
  // Marcador invisible dentro del contenedor `relative` del input: su padre es
  // el ancla de la lista (mismo ancho que el input).
  const anclaRef = useRef<HTMLSpanElement>(null);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const termino = texto.trim().toLowerCase();

  const coincidencias =
    termino.length === 0
      ? []
      : productos
          .filter((p) => p.nombre.toLowerCase().includes(termino) || p.sku?.toLowerCase().includes(termino))
          .slice(0, MAX_SUGERENCIAS);
  const hayLista = coincidencias.length > 0;

  useLayoutEffect(() => {
    if (!hayLista) return;
    function ubicar() {
      const ancla = anclaRef.current?.parentElement;
      if (!ancla) return;
      const r = ancla.getBoundingClientRect();
      const abajo = window.innerHeight - r.bottom - MARGEN * 2;
      const arriba = r.top - MARGEN * 2;
      // Abajo si cabe lo mínimo (o hay más espacio abajo); si no, hacia arriba.
      if (abajo >= ALTO_MINIMO || abajo >= arriba) {
        setPosicion({ left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.max(abajo, 120) });
      } else {
        setPosicion({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight: arriba });
      }
    }
    ubicar();
    // `true`: también el scroll de cualquier contenedor (el del cobro de la mesa).
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    return () => {
      window.removeEventListener("scroll", ubicar, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [hayLista, texto]);

  if (!hayLista) return null;

  return (
    <>
      <span ref={anclaRef} aria-hidden="true" className="hidden" />
      {posicion &&
        createPortal(
          <div
            // onMouseDown (no onClick) para que dispare ANTES del onBlur del input
            // — si no, el blur cierra el dropdown antes de que el click lo alcance.
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: posicion.left,
              width: posicion.width,
              top: posicion.top,
              bottom: posicion.bottom,
              maxHeight: posicion.maxHeight,
            }}
            className="z-[70] overflow-y-auto rounded-md border border-brand-vanilla-dark bg-white shadow-lg dark:border-brand-green-700 dark:bg-brand-green-900"
          >
            {coincidencias.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => onSeleccionar(p)}
                className="flex w-full items-center gap-2 border-b border-brand-vanilla-dark/50 px-2 py-1.5 text-left last:border-b-0 hover:bg-brand-green-50 dark:border-brand-green-700/50 dark:hover:bg-brand-green-700/40"
              >
                {p.imagen_url ? (
                  <span
                    onClick={(e) => {
                      // No seleccionar el producto al hacer clic en la imagen —
                      // solo ampliarla (ver lightbox más abajo).
                      e.stopPropagation();
                      setImagenAmpliada({ url: p.imagen_url!, nombre: p.nombre });
                    }}
                    title="Ver imagen en grande"
                    className="block h-9 w-9 shrink-0 cursor-zoom-in overflow-hidden rounded ring-1 ring-transparent hover:ring-brand-green-600"
                  >
                    <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
                  </span>
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
                  {textoMayorista(p) && (
                    <span className="block text-[10px] font-medium text-brand-green-700 dark:text-brand-vanilla">
                      {textoMayorista(p)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {imagenAmpliada && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setImagenAmpliada(null)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
        >
          <div className="relative">
            <img
              src={imagenAmpliada.url}
              alt={imagenAmpliada.nombre}
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setImagenAmpliada(null)}
              aria-label="Cerrar"
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg text-brand-ink shadow-lg hover:bg-brand-vanilla"
            >
              ✕
            </button>
            <p className="mt-2 text-center text-sm font-medium text-white">{imagenAmpliada.nombre}</p>
          </div>
        </div>
      )}
    </>
  );
}
