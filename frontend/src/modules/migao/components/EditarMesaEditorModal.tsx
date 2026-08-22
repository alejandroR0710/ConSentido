import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import type { Mesa } from "../api";

interface EditarMesaEditorModalProps {
  mesa: Mesa;
  onCerrar: () => void;
  onGuardar: (input: { numero?: string; capacidad?: number }) => Promise<void>;
  onEliminar: () => Promise<void>;
  onCambiarActivo: (activo: boolean) => Promise<void>;
}

/** Editar número/capacidad de una mesa ya dibujada, o quitarla del plano.
 *  "Eliminar" solo borra de verdad si la mesa nunca tuvo órdenes — si ya
 *  tiene historial, el backend responde con un conflicto y acá se sugiere
 *  desactivarla en su lugar (no rompe nada, solo se oculta del plano). */
export function EditarMesaEditorModal({ mesa, onCerrar, onGuardar, onEliminar, onCambiarActivo }: EditarMesaEditorModalProps) {
  const [numero, setNumero] = useState(mesa.numero);
  const [capacidad, setCapacidad] = useState(String(mesa.capacidad));
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugerenciaDesactivar, setSugerenciaDesactivar] = useState(false);

  async function guardar() {
    if (!numero.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar({ numero: numero.trim(), capacidad: Number(capacidad) || 4 });
      onCerrar();
    } catch {
      setError("No se pudo guardar la mesa (¿ya existe otra con ese número en esta área?)");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    setEliminando(true);
    setError(null);
    try {
      await onEliminar();
      onCerrar();
    } catch {
      setError('No se pudo eliminar: ya tiene órdenes asociadas. Usa "Desactivar" en su lugar.');
      setSugerenciaDesactivar(true);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Modal titulo={`Mesa ${mesa.numero}`} onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Número o nombre de mesa</label>
      <input
        autoFocus
        maxLength={10}
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        placeholder='Ej. "7" o "Terraza"'
      />

      <label className="mb-1 block text-xs font-medium">Capacidad (comensales)</label>
      <input
        inputMode="numeric"
        value={capacidad}
        onChange={(e) => setCapacidad(e.target.value.replace(/\D/g, ""))}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !numero.trim()}
        className="mb-3 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <div className="flex gap-2">
        {mesa.activo ? (
          <button
            onClick={() => onCambiarActivo(false).then(onCerrar)}
            className="flex-1 rounded-md border border-amber-500 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20"
          >
            Desactivar
          </button>
        ) : (
          <button
            onClick={() => onCambiarActivo(true).then(onCerrar)}
            className="flex-1 rounded-md border border-brand-green-600 px-3 py-2 text-sm font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
          >
            Reactivar
          </button>
        )}
        <button
          onClick={eliminar}
          disabled={eliminando}
          className="flex-1 rounded-md border border-red-500 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950/20"
        >
          {eliminando ? "Eliminando..." : "Eliminar"}
        </button>
      </div>
      {sugerenciaDesactivar && (
        <p className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
          Usa el botón "Desactivar" de arriba para ocultarla del plano sin perder su historial.
        </p>
      )}
    </Modal>
  );
}
