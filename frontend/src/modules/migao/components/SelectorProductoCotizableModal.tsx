import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import type { ProductoCotizable } from "../api";

interface SelectorProductoCotizableModalProps {
  productos: ProductoCotizable[];
  onCerrar: () => void;
  onSeleccionar: (producto: ProductoCotizable) => void;
}

const ETIQUETA_ORIGEN: Record<ProductoCotizable["origen"], string> = {
  migao: "Migao",
  con_sentido: "Con Sentido",
  insumos: "Insumos",
};

/**
 * Buscador para una línea de Cotización: mismo patrón de "tocar para elegir"
 * que SelectorProductoModal (las órdenes reales), pero sin nada de
 * stock/receta — una cotización nunca toca inventario, así que no hace
 * falta avisar de sin_stock/bajo_stock acá. Agrupa por origen (Migao/Con
 * Sentido/Insumos) para que quede claro de dónde sale cada uno.
 */
export function SelectorProductoCotizableModal({ productos, onCerrar, onSeleccionar }: SelectorProductoCotizableModalProps) {
  const [busqueda, setBusqueda] = useState("");
  const filtrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()));

  return (
    <Modal titulo="Buscar producto o servicio" onCerrar={onCerrar}>
      <input
        autoFocus
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar..."
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-3 text-base text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {/* Alto fijo: que haya 1 resultado o 20 no debe cambiar el tamaño del popup. */}
      <div className="h-[55vh] overflow-y-auto sm:h-96">
        {filtrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
            Sin resultados para "{busqueda}".
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtrados.map((p, idx) => {
              const cambioDeOrigen = idx === 0 || filtrados[idx - 1].origen !== p.origen;
              return (
                <li key={`${p.origen}-${p.id}`}>
                  {cambioDeOrigen && (
                    <div className="mb-1 mt-2 px-3 text-xs font-bold uppercase tracking-wide text-brand-green-700 first:mt-0 dark:text-brand-vanilla">
                      {ETIQUETA_ORIGEN[p.origen]}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      onSeleccionar(p);
                      onCerrar();
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30"
                  >
                    <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">{p.nombre}</span>
                    <span className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">{formatMoney(p.precio)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
