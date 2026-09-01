import { formatMoney } from "../format/money";
import { MoneyInput } from "./MoneyInput";

/** Ayuda al cajero a saber cuánto devolverle al cliente — y, desde que este
 *  monto quedó obligatorio y con registro (ver migao.service.ts::
 *  exigirMontoRecibidoEfectivo), también ES el dato real que se guarda: el
 *  monto cobrado/registrado en efectivo sigue siendo `aPagar` (el total o la
 *  parte a pagar), `recibido` es aparte, lo que el cliente entregó en mano.
 *  Solo aplica cuando hay efectivo de por medio (en Caja Migao al cobrar, y
 *  en Caja General al registrar un ingreso manual en efectivo). */
export function CalculadoraVuelta({
  aPagar,
  recibido,
  onChange,
}: {
  aPagar: number;
  recibido: number;
  onChange: (valor: number) => void;
}) {
  const vuelta = recibido - aPagar;
  const tieneRecibido = recibido > 0;
  const alcanza = vuelta >= 0;

  return (
    <div
      className={`rounded-lg border-2 p-3 transition-colors ${
        !tieneRecibido
          ? "border-brand-vanilla-dark dark:border-brand-green-700"
          : alcanza
            ? "border-brand-green-500 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-700/10"
            : "border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-950/20"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          💵 Pago en efectivo
        </span>
        <span className="text-brand-ink/60 dark:text-brand-vanilla/60">
          A cobrar <span className="font-semibold text-brand-ink dark:text-brand-vanilla">{formatMoney(aPagar)}</span>
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label className="shrink-0 text-sm font-medium text-brand-ink dark:text-brand-vanilla">Recibí</label>
        <MoneyInput
          value={recibido}
          onChange={onChange}
          placeholder="$0"
          className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-base font-semibold text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-brand-vanilla-dark pt-2 dark:border-brand-green-700/60">
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            !tieneRecibido
              ? "text-brand-ink/40 dark:text-brand-vanilla/40"
              : alcanza
                ? "text-brand-green-700 dark:text-brand-vanilla"
                : "text-red-600"
          }`}
        >
          {!tieneRecibido ? "Vuelta" : alcanza ? "↩ Vuelta" : "⚠ Falta"}
        </span>
        <span
          className={`text-2xl font-bold ${
            !tieneRecibido
              ? "text-brand-ink/30 dark:text-brand-vanilla/30"
              : alcanza
                ? "text-brand-green-700 dark:text-brand-vanilla"
                : "text-red-600"
          }`}
        >
          {!tieneRecibido ? "—" : formatMoney(Math.abs(vuelta))}
        </span>
      </div>
    </div>
  );
}
