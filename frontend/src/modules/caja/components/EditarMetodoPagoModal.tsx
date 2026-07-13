import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type MetodoPago, type MovimientoCaja } from "../api";

interface EditarMetodoPagoModalProps {
  movimiento: MovimientoCaja;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
}

export function EditarMetodoPagoModal({ movimiento, onCerrar, onGuardado }: EditarMetodoPagoModalProps) {
  const [metodo, setMetodo] = useState<MetodoPago>(movimiento.metodo_pago);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.editarMetodoPagoMovimiento(movimiento.id, metodo);
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo corregir el método de pago");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Corregir método de pago" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        {movimiento.modulo_origen_slug ?? movimiento.categoria_gasto_nombre ?? "Movimiento"} ·{" "}
        {formatMoney(Number(movimiento.monto))}
      </p>

      <label className="mb-1 block text-xs font-medium">Método de pago correcto</label>
      <select
        autoFocus
        value={metodo}
        onChange={(e) => setMetodo(e.target.value as MetodoPago)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="efectivo">Efectivo</option>
        <option value="banco">Banco</option>
      </select>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || metodo === movimiento.metodo_pago}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar corrección"}
      </button>
    </Modal>
  );
}
