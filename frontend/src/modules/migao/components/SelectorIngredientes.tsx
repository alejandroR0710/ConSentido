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
                <select
                  value={fila.inventarioProductoId}
                  onChange={(e) => actualizarFila(idx, { inventarioProductoId: e.target.value })}
                  className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                >
                  {inventario.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
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
