import type { ReactNode } from "react";
import { useState } from "react";
import { cajaApi, type MetodoPago, type ModuloOrigenSlug } from "../../modules/caja/api";
import { MODULOS_ORIGEN } from "../../modules/caja/moduloOrigen";
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
  /** El área (de dónde vino el ingreso) solo aplica a ingresos — los egresos
   *  se clasifican por categoría de gasto, no por módulo. Si no se manda, el
   *  selector de área no se muestra. */
  tipo?: "ingreso" | "egreso";
  moduloOrigenActual?: ModuloOrigenSlug | null;
  /** Contexto adicional opcional (ej. productos/mesero/fecha de la cuenta en
   *  Migao) que se muestra arriba del selector de método — el modal en sí no
   *  necesita saber qué es, solo dónde ponerlo. */
  children?: ReactNode;
}

/**
 * Corrección de método de pago (efectivo/banco/mixto) y/o de área de origen
 * (Migao/Con Sentido/Insumos/...) de un movimiento ya registrado. Se usa tanto
 * desde Caja General (movimientos del turno) como desde el historial de Migao
 * (órdenes cobradas + ingresos manuales) — ambas vistas apuntan al mismo
 * movimiento en `movimientos_caja`, solo cambia desde dónde se abre el modal.
 * Exclusivo de Super Root (el backend valida el permiso).
 */
export function EditarMetodoPagoModal({
  movimientoId,
  metodoPagoActual,
  monto,
  etiqueta,
  onCerrar,
  onGuardado,
  tipo,
  moduloOrigenActual,
  children,
}: EditarMetodoPagoModalProps) {
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: metodoPagoActual });
  const [moduloOrigen, setModuloOrigen] = useState<ModuloOrigenSlug | null>(moduloOrigenActual ?? null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeEditarArea = tipo === "ingreso";
  const sinCambios = pago.metodoPago === metodoPagoActual && moduloOrigen === (moduloOrigenActual ?? null);
  const mixtoInvalido = pago.metodoPago === "mixto" && Math.abs(pago.montoEfectivo + pago.montoBanco - monto) > 0.01;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await cajaApi.editarMetodoPagoMovimiento(movimientoId, {
        ...pago,
        moduloOrigenSlug: puedeEditarArea && moduloOrigen && moduloOrigen !== moduloOrigenActual ? moduloOrigen : undefined,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la corrección");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Corregir movimiento" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        {etiqueta} · {formatMoney(monto)}
      </p>

      {children}

      <label className="mb-1 block text-xs font-medium">Método de pago correcto</label>
      <div className="mb-4">
        <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={monto} />
      </div>

      {puedeEditarArea && (
        <>
          <label className="mb-1 block text-xs font-medium">Área correcta</label>
          <select
            value={moduloOrigen ?? ""}
            onChange={(e) => setModuloOrigen(e.target.value as ModuloOrigenSlug)}
            className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            {MODULOS_ORIGEN.map((m) => (
              <option key={m.value} value={m.value}>
                {m.icon} {m.label}
              </option>
            ))}
          </select>
        </>
      )}

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
