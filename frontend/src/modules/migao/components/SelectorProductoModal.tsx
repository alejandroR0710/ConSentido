import { useRef, useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import type { Producto } from "../api";

interface SelectorProductoModalProps {
  productos: Producto[];
  onCerrar: () => void;
  onSeleccionar: (producto: Producto) => void;
  agregandoId: string | null;
}

const DURACION_CONFIRMACION_MS = 900;

/**
 * Buscador de menú: tocar un producto lo agrega de una vez (cantidad 1) y deja
 * el modal abierto para seguir agregando rápido. Pensado como flujo principal
 * en mobile, donde un <select> largo es incómodo.
 */
export function SelectorProductoModal({ productos, onCerrar, onSeleccionar, agregandoId }: SelectorProductoModalProps) {
  const [busqueda, setBusqueda] = useState("");
  const [agregadoId, setAgregadoId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()));

  function seleccionar(p: Producto) {
    onSeleccionar(p);
    // Confirmación visual inmediata ("✓ Agregado") aunque el guardado real (API
    // o borrador local) siga su curso aparte — el mesero necesita saber YA que
    // el toque registró, sin esperar la respuesta del servidor.
    setAgregadoId(p.id);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setAgregadoId(null), DURACION_CONFIRMACION_MS);
  }

  return (
    <Modal titulo="Agregar producto" onCerrar={onCerrar}>
      <input
        autoFocus
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar producto..."
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-3 text-base text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {/* Alto fijo: que haya 1 resultado o 20 no debe cambiar el tamaño del popup
          (si no, el buscador "salta" cada vez que la búsqueda reduce la lista). */}
      <div className="h-[55vh] overflow-y-auto sm:h-96">
        {filtrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
            Sin resultados para "{busqueda}".
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtrados.map((p, idx) => {
              const categoria = p.categoria_nombre ?? "Sin categoría";
              const cambioDeCategoria =
                idx === 0 || (filtrados[idx - 1].categoria_nombre ?? "Sin categoría") !== categoria;
              const recienAgregado = agregadoId === p.id;
              return (
                <li key={p.id}>
                  {cambioDeCategoria && (
                    <div className="mb-1 mt-2 px-3 text-xs font-bold uppercase tracking-wide text-brand-green-700 first:mt-0 dark:text-brand-vanilla">
                      {categoria}
                    </div>
                  )}
                  <button
                    onClick={() => seleccionar(p)}
                    disabled={agregandoId === p.id}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                      recienAgregado
                        ? "bg-brand-green-100 dark:bg-brand-green-700/50"
                        : "hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30"
                    }`}
                  >
                    <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">{p.nombre}</span>
                    <span
                      className={`text-sm ${
                        recienAgregado
                          ? "font-semibold text-brand-green-700 dark:text-brand-vanilla"
                          : "text-brand-ink/60 dark:text-brand-vanilla/60"
                      }`}
                    >
                      {agregandoId === p.id ? "Agregando..." : recienAgregado ? "✓ Agregado" : formatMoney(p.precio)}
                    </span>
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
