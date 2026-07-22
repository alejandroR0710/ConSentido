import { useEffect, useState } from "react";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import type { InventarioProducto } from "../api";

export interface FilaIngrediente {
  inventarioProductoId: string;
  cantidadPorUnidad: number;
}

interface SelectorIngredientesProps {
  inventario: InventarioProducto[];
  value: FilaIngrediente[];
  onChange: (value: FilaIngrediente[]) => void;
}

/** Combobox con búsqueda para elegir un producto de inventario en una fila —
 *  reemplaza el <select> plano, útil apenas el catálogo crece más allá de
 *  unos pocos productos. */
function ComboboxIngrediente({
  inventario,
  productoId,
  onSeleccionar,
}: {
  inventario: InventarioProducto[];
  productoId: string;
  onSeleccionar: (id: string) => void;
}) {
  const seleccionado = inventario.find((p) => p.id === productoId);
  const [busqueda, setBusqueda] = useState(seleccionado?.nombre ?? "");
  const [abierto, setAbierto] = useState(false);

  // Si la selección cambia desde afuera (ej. otra fila tomó este producto, o
  // se cargó la receta al abrir Editar producto), refleja el nombre actual.
  useEffect(() => {
    setBusqueda(seleccionado?.nombre ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  const filtrados = inventario.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()));

  return (
    <div className="relative flex-1">
      <input
        value={busqueda}
        onChange={(e) => {
          setBusqueda(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        // El timeout deja que el click en una opción (onMouseDown más abajo)
        // se registre antes de que el blur cierre la lista.
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Buscar producto de inventario..."
        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />
      {abierto && (
        <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-brand-vanilla-dark bg-brand-vanilla shadow-lg dark:border-brand-green-700 dark:bg-brand-green-900">
          {filtrados.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">Sin resultados.</p>
          ) : (
            filtrados.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSeleccionar(p.id);
                  setBusqueda(p.nombre);
                  setAbierto(false);
                }}
                className="block w-full px-2 py-1.5 text-left text-sm text-brand-ink hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                {p.nombre}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Receta de un producto del menú: qué ingredientes de inventario consume por
 * cada unidad vendida. Un producto sin filas acá simplemente no toca
 * inventario al venderse (ver aplicarConsumoPorProducto en el backend). Se
 * usa tanto en Nuevo como en Editar producto — la lista se guarda completa
 * (reemplaza) al confirmar el modal, no fila por fila.
 */
export function SelectorIngredientes({ inventario, value, onChange }: SelectorIngredientesProps) {
  function agregarFila() {
    if (inventario.length === 0) return;
    onChange([...value, { inventarioProductoId: inventario[0].id, cantidadPorUnidad: 1 }]);
  }

  function actualizarFila(idx: number, cambios: Partial<FilaIngrediente>) {
    onChange(value.map((fila, i) => (i === idx ? { ...fila, ...cambios } : fila)));
  }

  function quitarFila(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="mb-4">
      <label className="mb-1 block text-xs font-medium">Ingredientes de inventario (opcional)</label>
      {inventario.length === 0 ? (
        <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          Todavía no hay productos en Inventario para elegir.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {value.map((fila, idx) => {
            const producto = inventario.find((p) => p.id === fila.inventarioProductoId);
            return (
              <div key={idx} className="flex items-center gap-2">
                <ComboboxIngrediente
                  inventario={inventario}
                  productoId={fila.inventarioProductoId}
                  onSeleccionar={(id) => actualizarFila(idx, { inventarioProductoId: id })}
                />
                <NumeroInput
                  value={fila.cantidadPorUnidad}
                  onChange={(v) => actualizarFila(idx, { cantidadPorUnidad: v })}
                  className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
                <span className="w-16 shrink-0 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                  {producto?.unidad_medida ?? ""}
                </span>
                <button
                  type="button"
                  onClick={() => quitarFila(idx)}
                  aria-label="Quitar ingrediente"
                  className="shrink-0 rounded-md border border-brand-vanilla-dark px-2 py-1.5 text-xs text-brand-ink/60 hover:bg-red-50 hover:text-red-600 dark:border-brand-green-700 dark:text-brand-vanilla/60"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={agregarFila}
        disabled={inventario.length === 0}
        className="mt-2 rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
      >
        + Agregar ingrediente
      </button>
    </div>
  );
}
