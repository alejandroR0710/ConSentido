import type { ReactNode } from "react";
import { useState } from "react";
import { cajaApi, type MetodoPago } from "../../modules/caja/api";
import { ApiError } from "../api/client";
import { formatMoney } from "../format/money";
import { Modal } from "./Modal";
import { SelectorMetodoPago, type MetodoPagoValor } from "./SelectorMetodoPago";

interface EditarMetodoPagoModalProps {
  movimientoId: number | string;
  metodoPagoActual: MetodoPago;
  monto: number;
  etiqueta: string;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
  /** Contexto adicional opcional (ej. productos/mesero/fecha de la cuenta en
   *  Migao) que se muestra arriba del selector de método — el modal en sí no
   *  necesita saber qué es, solo dónde ponerlo. */
  children?: ReactNode;
}

/**
 * Corrección de método de pago (efectivo/banco/mixto) de un movimiento ya
 * registrado. Se usa tanto desde Caja General (movimientos del turno) como
 * desde el historial de Migao (órdenes cobradas + ingresos manuales) — ambas
 * vistas apuntan al mismo movimiento en `movimientos_caja`, solo cambia desde
 * dónde se abre el modal. Exclusivo de Super Root (el backend valida el permiso).
 */
export function EditarMetodoPagoModal({
  movimientoId,
  metodoPagoActual,
  monto,
  etiqueta,
  onCerrar,
  onGuardado,
  children,
}: EditarMetodoPagoModalProps) {
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: metodoPagoActual });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinCambios = pago.metodoPago === metodoPagoActual;
  const mixtoInvalido = pago.metodoPago === "mixto" && Math.abs(pago.montoEfectivo + pago.montoBanco - monto) > 0.01;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.editarMetodoPagoMovimiento(movimientoId, pago);
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
        {etiqueta} · {formatMoney(monto)}
      </p>

      {children}

      <label className="mb-1 block text-xs font-medium">Método de pago correcto</label>
      <div className="mb-4">
        <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={monto} />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || sinCambios || mixtoInvalido}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar corrección"}
      </button>
    </Modal>
  );
}
