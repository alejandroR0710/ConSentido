import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi } from "../api";

interface EditarNombreOrdenModalProps {
  ordenId: string;
  nombreActual: string | null;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

/** Ponerle/cambiarle/borrarle el nombre a una cuenta desde Caja Migao (ej.
 *  "Cumpleaños de Juan") — a diferencia de "Editar cuenta" en Mesero, acá NO
 *  se toca la mesa, solo el nombre (endpoint y permiso aparte, ver
 *  migao.routes.ts::migao.ordenes.editar_nombre). */
export function EditarNombreOrdenModal({ ordenId, nombreActual, onCerrar, onGuardado }: EditarNombreOrdenModalProps) {
  const [nombre, setNombre] = useState(nombreActual ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.editarNombreOrden(ordenId, nombre.trim());
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el nombre");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nombre de la cuenta" onCerrar={onCerrar} maxWidth="sm:max-w-sm">
      <label className="mb-1 block text-xs font-medium">Nombre (opcional)</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder='Ej. "Cumpleaños de Juan"'
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar"}
      </button>
    </Modal>
  );
}
