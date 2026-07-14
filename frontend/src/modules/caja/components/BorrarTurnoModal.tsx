import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type TurnoCaja } from "../api";

const FRASE_CONFIRMACION = "BORRAR TURNO";

interface BorrarTurnoModalProps {
  turno: TurnoCaja;
  onCerrar: () => void;
  onBorrado: (mensaje: string) => Promise<void> | void;
}

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Borrado permanente exclusivo de Super Root: borra el turno completo (fila
 *  de turnos_caja) y todos sus movimientos. No aplica al turno abierto — para
 *  ese caso existe "Reiniciar Caja" (ver caja.service.ts). */
export function BorrarTurnoModal({ turno, onCerrar, onBorrado }: BorrarTurnoModalProps) {
  const [frase, setFrase] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (frase !== FRASE_CONFIRMACION) return;
    setBorrando(true);
    setError(null);
    try {
      const resultado = await cajaApi.borrarTurno(turno.id);
      await onBorrado(`Turno borrado (${formatearHora(turno.abiertoEn)}): ${resultado.movimientosBorrados} movimiento(s) eliminados.`);
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el turno");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Modal titulo="Borrar turno" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Turno abierto {formatearHora(turno.abiertoEn)}
        {turno.cerradoEn && <> · cerrado {formatearHora(turno.cerradoEn)}</>}.
      </p>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto borra <strong>por completo</strong> este turno y todos sus movimientos (
        {turno.montoFinalCalculadoEfectivo !== null && (
          <>efectivo final {formatMoney(Number(turno.montoFinalCalculadoEfectivo))}</>
        )}
        ).
      </p>
      <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        No se puede deshacer.
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
        {borrando ? "Borrando..." : "Borrar turno"}
      </button>
    </Modal>
  );
}
