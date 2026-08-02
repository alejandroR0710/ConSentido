import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type MovimientoCaja } from "../api";
import { LABEL_POR_MODULO_SLUG } from "../moduloOrigen";

const FRASE_CONFIRMACION = "ANULAR VENTA";

interface AnularVentaModalProps {
  movimiento: MovimientoCaja;
  onCerrar: () => void;
  onAnulado: () => Promise<void> | void;
}

/**
 * Anula una venta (Migao o Con Sentido) desde cualquier día del historial —
 * Root o Super Root. No borra la venta de verdad (queda para auditoría con
 * estado='anulada'), solo sus pagos/movimientos de Caja, así que deja de
 * contar en los totales.
 */
export function AnularVentaModal({ movimiento, onCerrar, onAnulado }: AnularVentaModalProps) {
  const [nota, setNota] = useState("");
  const [frase, setFrase] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeGuardar = nota.trim().length >= 3 && frase === FRASE_CONFIRMACION;
  const etiqueta = movimiento.modulo_origen_slug
    ? (LABEL_POR_MODULO_SLUG[movimiento.modulo_origen_slug] ?? movimiento.modulo_origen_slug)
    : "Venta";

  async function anular() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.anularVenta(movimiento.id, nota.trim());
      await onAnulado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo anular la venta");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Anular venta" onCerrar={onCerrar}>
      <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        Esto quita esta venta de los totales de Caja de forma permanente. El registro de la venta se conserva (queda
        marcada como anulada), pero no se puede deshacer desde acá.
      </p>

      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        {etiqueta} · {formatMoney(movimiento.monto)} · {movimiento.metodo_pago}
        {movimiento.motivo && <> · {movimiento.motivo}</>}
      </p>

      <label className="mb-1 block text-xs font-medium">Nota — ¿por qué se anula?</label>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={2}
        placeholder='Ej. "Se cobró dos veces por error"'
        className="mb-3 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">
        Escribe <span className="font-mono">{FRASE_CONFIRMACION}</span> para confirmar
      </label>
      <input
        value={frase}
        onChange={(e) => setFrase(e.target.value)}
        placeholder={FRASE_CONFIRMACION}
        className="mb-4 w-full rounded-md border border-red-400 bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-red-600 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={anular}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {guardando ? "Anulando..." : "Anular venta"}
      </button>
    </Modal>
  );
}
