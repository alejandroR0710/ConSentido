import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatMoney } from "../../../shared/format/money";
import type { ProductoCotizable } from "../api";

interface SugerenciasProductoCotizableProps {
  productos: ProductoCotizable[];
  texto: string;
  onSeleccionar: (producto: ProductoCotizable) => void;
}

const ETIQUETA_ORIGEN: Record<ProductoCotizable["origen"], string> = {
  migao: "Migao",
  con_sentido: "Con Sentido",
  insumos: "Insumos",
};

const MAX_SUGERENCIAS = 6;
const MARGEN = 8;
const ALTO_MINIMO = 160;

type Posicion = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Dropdown de sugerencias bajo el input "Producto o servicio" de una línea
 * de Cotización — mismo patrón que SugerenciasProducto.tsx (Caja → Registrar
 * ingreso): filtra a medida que se escribe, se dibuja en un portal
 * (document.body) con posición fija anclada al input, para que no quede
 * recortado por ningún contenedor con scroll. Combina los 3 catálogos
 * (Migao/Con Sentido/Insumos) — a diferencia de esa otra, que es solo de Con
 * Sentido — así que cada sugerencia muestra de dónde viene. Elegir una
 * precarga nombre+precio; nunca toca inventario ni stock, es solo texto para
 * la cotización (no hay productoId enganchado, a propósito).
 */
export function SugerenciasProductoCotizable({ productos, texto, onSeleccionar }: SugerenciasProductoCotizableProps) {
  const anclaRef = useRef<HTMLSpanElement>(null);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const termino = texto.trim().toLowerCase();

  const coincidencias = termino.length === 0 ? [] : productos.filter((p) => p.nombre.toLowerCase().includes(termino)).slice(0, MAX_SUGERENCIAS);
  const hayLista = coincidencias.length > 0;

  useLayoutEffect(() => {
    if (!hayLista) return;
    function ubicar() {
      const ancla = anclaRef.current?.parentElement;
      if (!ancla) return;
      const r = ancla.getBoundingClientRect();
      const abajo = window.innerHeight - r.bottom - MARGEN * 2;
      const arriba = r.top - MARGEN * 2;
      if (abajo >= ALTO_MINIMO || abajo >= arriba) {
        setPosicion({ left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.max(abajo, 120) });
      } else {
        setPosicion({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight: arriba });
      }
    }
    ubicar();
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
            // onMouseDown (no onClick) para que dispare ANTES del onBlur del
            // input — si no, el blur cierra el dropdown antes de que el click lo alcance.
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
                key={`${p.origen}-${p.id}`}
                onClick={() => onSeleccionar(p)}
                className="flex w-full items-center justify-between gap-2 border-b border-brand-vanilla-dark/50 px-2 py-1.5 text-left last:border-b-0 hover:bg-brand-green-50 dark:border-brand-green-700/50 dark:hover:bg-brand-green-700/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                    {p.nombre}
                  </span>
                  <span className="block text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                    {ETIQUETA_ORIGEN[p.origen]}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
                  {formatMoney(p.precio)}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
