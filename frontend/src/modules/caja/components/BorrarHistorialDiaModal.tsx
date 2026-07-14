import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { cajaApi } from "../api";

const FRASE_CONFIRMACION = "BORRAR HISTORIAL DEL DIA";

interface BorrarHistorialDiaModalProps {
  fecha: string;
  onCerrar: () => void;
  onBorrado: (mensaje: string) => Promise<void> | void;
}

/** Borrado permanente exclusivo de Super Root: a diferencia de "Reiniciar
 *  Caja", esto sí borra datos (los movimientos de ese día) y no se puede
 *  deshacer. No toca los turnos_caja de ese día (sus montos de apertura/cierre
 *  quedan como registro), solo su detalle de ingresos/egresos. */
export function BorrarHistorialDiaModal({ fecha, onCerrar, onBorrado }: BorrarHistorialDiaModalProps) {
  const [frase, setFrase] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (frase !== FRASE_CONFIRMACION) return;
    setBorrando(true);
    setError(null);
    try {
      const resultado = await cajaApi.borrarHistorialDia(fecha);
      await onBorrado(`Se borraron ${resultado.movimientosBorrados} movimiento(s) del ${fecha}.`);
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el historial de ese día");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Modal titulo={`Borrar historial del ${fecha}`} onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto borra <strong>por completo</strong> todos los ingresos y egresos registrados el {fecha}.
      </p>
      <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        No se puede deshacer. Los turnos de ese día no se borran, solo su detalle de movimientos.
      </p>

      <label className="mb-1 block text-xs font-medium">
        Escribe <span className="font-mono">{FRASE_CONFIRMACION}</span> para confirmar
      </label>
      <input
        autoFocus
        value={frase}
        onChange={(e) => setFrase(e.target.value)}
        placeholder={FRASE_CONFIRMACION}
        className="mb-4 w-full rounded-md border border-red-300 bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-red-500 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={confirmar}
        disabled={borrando || frase !== FRASE_CONFIRMACION}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {borrando ? "Borrando..." : "Borrar historial del día"}
      </button>
    </Modal>
  );
}
