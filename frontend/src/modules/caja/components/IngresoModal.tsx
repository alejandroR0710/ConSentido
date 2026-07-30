import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type ModuloOrigenSlug } from "../api";
import { MODULOS_ORIGEN } from "../moduloOrigen";

interface IngresoModalProps {
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

export function IngresoModal({ onCerrar, onRegistrado }: IngresoModalProps) {
  const [modulo, setModulo] = useState<ModuloOrigenSlug>("migao");
  // "Monto" siempre es el bruto (antes de descuento); lo que realmente se
  // registra/suma al turno es el neto ya descontado (montoNeto más abajo).
  const [monto, setMonto] = useState(0);
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [montoRecibido, setMontoRecibido] = useState(0);
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const montoNeto = monto * (1 - descuentoPorcentaje / 100);
  const mixtoInvalido =
    pago.metodoPago === "mixto" && Math.abs(pago.montoEfectivo + pago.montoBanco - montoNeto) > 0.01;
  const puedeRegistrar = montoNeto > 0 && !mixtoInvalido;

  async function registrar() {
    if (!puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarIngreso({
        moduloOrigenSlug: modulo,
        motivo: motivo.trim() || undefined,
        descuentoPorcentaje: descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
        ...(pago.metodoPago === "mixto" ? pago : { metodoPago: pago.metodoPago, monto: montoNeto }),
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
      <label className="mb-2 block text-xs font-medium">Viene de</label>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {MODULOS_ORIGEN.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setModulo(m.value)}
            autoFocus={m.value === "migao"}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-colors ${
              modulo === m.value
                ? "border-brand-green-600 bg-brand-green-50 dark:border-brand-green-400 dark:bg-brand-green-700/30"
                : "border-brand-vanilla-dark hover:border-brand-green-400 dark:border-brand-green-700 dark:hover:border-brand-green-600"
            }`}
          >
            <span className="text-2xl">{m.icon}</span>
            <span className="text-xs font-medium leading-tight text-brand-ink dark:text-brand-vanilla">{m.label}</span>
          </button>
        ))}
      </div>

      <label className="mb-1 block text-xs font-medium">Monto</label>
      <MoneyInput
        value={monto}
        onChange={setMonto}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs font-medium">Descuento %</label>
        <input
          type="number"
          min={0}
          max={100}
          step="1"
          value={descuentoPorcentaje || ""}
          onChange={(e) => setDescuentoPorcentaje(Math.min(100, Math.max(0, Number(e.target.value))))}
          placeholder="0"
          className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        {descuentoPorcentaje > 0 && (
          <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            A registrar: {formatMoney(montoNeto)}
          </span>
        )}
      </div>

      <label className="mb-1 block text-xs font-medium">Método</label>
      <div className="mb-3">
        <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={montoNeto} />
      </div>

      {pago.metodoPago === "efectivo" && (
        <div className="mb-3">
          <CalculadoraVuelta aPagar={montoNeto} recibido={montoRecibido} onChange={setMontoRecibido} />
        </div>
      )}

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
