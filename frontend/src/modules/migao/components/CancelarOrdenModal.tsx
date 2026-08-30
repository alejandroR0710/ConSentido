import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi } from "../api";

interface CancelarOrdenModalProps {
  ordenId: string;
  onCerrar: () => void;
  onCancelada: (mensaje: string) => Promise<void> | void;
}

/** Cancela la mesa/orden completa (ej. el cliente ya no quiere pedir): cada
 *  producto todavía activo pasa a "cancelado", igual que si el mesero
 *  cancelara cada ítem, y queda registrado en el historial de la orden. */
export function CancelarOrdenModal({ ordenId, onCerrar, onCancelada }: CancelarOrdenModalProps) {
  const [cancelando, setCancelando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setCancelando(true);
    setError(null);
    try {
      const resultado = await migaoApi.cancelarOrden(ordenId);
      const sufijoAlertas = resultado.alertasInventario.length > 0 ? ` ${resultado.alertasInventario.join(" ")}` : "";
      await onCancelada(`Orden cancelada.${sufijoAlertas}`);
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cancelar la orden");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <Modal titulo="Cancelar orden" onCerrar={onCerrar}>
      <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto cancela la mesa completa: todos sus productos pasan a "cancelado" y la orden se cierra sin cobrar. Úsalo
        cuando el cliente ya no quiere pedir.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onCerrar}
          disabled={cancelando}
          className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium text-brand-ink hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          Volver
        </button>
        <button
          onClick={confirmar}
          disabled={cancelando}
          className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {cancelando ? "Cancelando..." : "Sí, cancelar orden"}
        </button>
      </div>
    </Modal>
  );
}
