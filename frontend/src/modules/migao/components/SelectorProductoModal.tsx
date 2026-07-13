import { useRef, useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import type { Producto } from "../api";

interface SelectorProductoModalProps {
  productos: Producto[];
  onCerrar: () => void;
  onSeleccionar: (producto: Producto, cantidad: number) => void;
  agregandoId: string | null;
}

const DURACION_CONFIRMACION_MS = 900;

/**
 * Buscador de menú: tocar un producto abre un selector de cantidad en línea
 * (-/+  y "Agregar") en esa misma fila, para no tener que tocar N veces el
 * mismo producto cuando el mesero necesita más de 1 unidad.
 */
export function SelectorProductoModal({ productos, onCerrar, onSeleccionar, agregandoId }: SelectorProductoModalProps) {
  const [busqueda, setBusqueda] = useState("");
  const [agregadoId, setAgregadoId] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<{ producto: Producto; cantidad: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()));

  function abrirCantidad(p: Producto) {
    setEligiendo((actual) => (actual?.producto.id === p.id ? null : { producto: p, cantidad: 1 }));
  }

  function confirmar() {
    if (!eligiendo) return;
    const { producto, cantidad } = eligiendo;
    onSeleccionar(producto, cantidad);
    setEligiendo(null);
    // Confirmación visual inmediata ("✓ Agregado") aunque el guardado real (API
    // o borrador local) siga su curso aparte — el mesero necesita saber YA que
    // el toque registró, sin esperar la respuesta del servidor.
    setAgregadoId(producto.id);
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
              const eligiendoEste = eligiendo?.producto.id === p.id;
              return (
                <li key={p.id}>
                  {cambioDeCategoria && (
                    <div className="mb-1 mt-2 px-3 text-xs font-bold uppercase tracking-wide text-brand-green-700 first:mt-0 dark:text-brand-vanilla">
                      {categoria}
                    </div>
                  )}
                  {eligiendoEste ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-brand-green-100 px-3 py-3 dark:bg-brand-green-700/50">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">{p.nombre}</span>
                        <span className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">{formatMoney(p.precio)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEligiendo({ producto: p, cantidad: Math.max(1, eligiendo.cantidad - 1) })}
                          className="flex h-11 w-11 items-center justify-center rounded-md border border-brand-green-700 text-xl font-bold text-brand-green-700 dark:border-brand-vanilla dark:text-brand-vanilla"
                        >
                          −
                        </button>
                        <span className="w-10 text-center text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                          {eligiendo.cantidad}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEligiendo({ producto: p, cantidad: eligiendo.cantidad + 1 })}
                          className="flex h-11 w-11 items-center justify-center rounded-md border border-brand-green-700 text-xl font-bold text-brand-green-700 dark:border-brand-vanilla dark:text-brand-vanilla"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={confirmar}
                          disabled={agregandoId === p.id}
                          className="ml-auto flex-1 rounded-md bg-brand-green-700 px-3 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                        >
                          {agregandoId === p.id
                            ? "Agregando..."
                            : `Agregar · ${formatMoney(Number(p.precio) * eligiendo.cantidad)}`}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => abrirCantidad(p)}
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
                        {recienAgregado ? "✓ Agregado" : formatMoney(p.precio)}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
