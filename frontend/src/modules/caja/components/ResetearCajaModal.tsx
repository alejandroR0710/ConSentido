import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { cajaApi } from "../api";

const FRASE_CONFIRMACION = "REINICIAR CAJA";

interface ResetearCajaModalProps {
  onCerrar: () => void;
  onReseteado: (mensaje: string) => Promise<void>;
}

/** Reset exclusivo de Super Root: NO borra el historial de ingresos (turnos y
 *  movimientos pasados siguen intactos para los reportes de Caja), pero SÍ
 *  borra por completo los egresos del turno abierto — a diferencia del resto
 *  del reset, esto no se puede deshacer. Exige escribir la frase de
 *  confirmación para evitar un clic accidental en una acción tan sensible. */
export function ResetearCajaModal({ onCerrar, onReseteado }: ResetearCajaModalProps) {
  const [frase, setFrase] = useState("");
  const [reseteando, setReseteando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (frase !== FRASE_CONFIRMACION) return;
    setReseteando(true);
    setError(null);
    try {
      const resultado = await cajaApi.resetear();
      await onReseteado(
        `Caja reiniciada: el saldo vuelve a $0 y se borraron ${resultado.egresosBorrados} egreso(s) del turno. El historial de ingresos anteriores sigue disponible.`,
      );
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reiniciar la caja");
    } finally {
      setReseteando(false);
    }
  }

  return (
    <Modal titulo="Reiniciar Caja General" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto cierra el turno actual (si hay uno abierto) y hace que el próximo turno arranque en{" "}
        <strong>$0 efectivo y $0 banco</strong>, en vez de heredar el saldo del cierre anterior.
      </p>
      <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        Los <strong>egresos del turno abierto se borran por completo</strong> (esto no se puede deshacer). Los
        ingresos y los turnos anteriores no se tocan.
      </p>
      <p className="mb-4 rounded-md bg-brand-green-50 px-3 py-2 text-xs text-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
        Ningún turno ni ingreso anterior se borra: siguen disponibles en el historial de Caja para consultar después.
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
        disabled={reseteando || frase !== FRASE_CONFIRMACION}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {reseteando ? "Reiniciando..." : "Reiniciar Caja a $0"}
      </button>
    </Modal>
  );
}
