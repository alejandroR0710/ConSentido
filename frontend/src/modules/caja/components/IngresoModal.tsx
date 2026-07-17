import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { cajaApi, type ModuloOrigenSlug } from "../api";
import { MODULOS_ORIGEN } from "../moduloOrigen";

interface IngresoModalProps {
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

export function IngresoModal({ onCerrar, onRegistrado }: IngresoModalProps) {
  const [modulo, setModulo] = useState<ModuloOrigenSlug>("migao");
  const [monto, setMonto] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  const puedeRegistrar = pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0;

  async function registrar() {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarIngreso({
        moduloOrigenSlug: modulo,
        motivo: motivo.trim() || undefined,
        ...(pago.metodoPago === "mixto" ? pago : { metodoPago: pago.metodoPago, monto }),
      });
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el ingreso");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo="Registrar ingreso" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Viene de</label>
      <select
        autoFocus
        value={modulo}
        onChange={(e) => setModulo(e.target.value as ModuloOrigenSlug)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        {MODULOS_ORIGEN.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      {pago.metodoPago !== "mixto" && (
        <div className="mb-1">
          <label className="mb-1 block text-xs font-medium">Monto</label>
          <MoneyInput
            value={monto}
            onChange={setMonto}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      )}
      <label className="mb-1 block text-xs font-medium">Método</label>
      <div className="mb-3">
        <SelectorMetodoPago value={pago} onChange={setPago} />
      </div>

      <label className="mb-1 block text-xs font-medium">Motivo (opcional)</label>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "Registrar ingreso"}
      </button>
    </Modal>
  );
}
