import { formatMoney } from "../format/money";
import { MoneyInput } from "./MoneyInput";

/** Ayuda al cajero a saber cuánto devolverle al cliente — y, desde que este
 *  monto quedó obligatorio y con registro (ver migao.service.ts::
 *  exigirMontoRecibidoEfectivo), también ES el dato real que se guarda: el
 *  monto cobrado/registrado en efectivo sigue siendo `aPagar` (el total o la
 *  parte a pagar), `recibido` es aparte, lo que el cliente entregó en mano.
 *  Solo aplica cuando hay efectivo de por medio (en Caja Migao al cobrar, y
 *  en Caja General al registrar un ingreso manual en efectivo).
 *
 *  Mismos colores de estado que el campo de referencia de banco
 *  (SelectorMetodoPago): ámbar mientras falta algo para poder cobrar, verde
 *  cuando ya está completo. */
export function CalculadoraVuelta({
  aPagar,
  recibido,
  onChange,
  esParteDeMixto = false,
}: {
  aPagar: number;
  recibido: number;
  onChange: (valor: number) => void;
  /** En un pago mixto `aPagar` es solo la parte en efectivo — se aclara en el
   *  título para que no se confunda con el total de la cuenta. */
  esParteDeMixto?: boolean;
}) {
  const vuelta = recibido - aPagar;
  const tieneRecibido = recibido > 0;
  const completo = tieneRecibido && vuelta >= -0.01;
  const exacto = completo && Math.abs(vuelta) < 0.01;

  // Nada en efectivo que cobrar (ej. mixto con todo por banco): no aplica.
  if (aPagar <= 0) return null;

  const colorTexto = completo ? "text-brand-green-700 dark:text-brand-vanilla" : "text-amber-700 dark:text-amber-400";

  return (
    <div
      className={`rounded-lg border-2 p-3 transition-colors ${
        completo
          ? "border-brand-green-600 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-700/20"
          : "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          💵 {esParteDeMixto ? "Parte en efectivo" : "Pago en efectivo"}
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

      <div
        className={`mt-2 flex items-center justify-between gap-2 border-t border-dashed pt-2 ${
          completo ? "border-brand-green-600/40" : "border-amber-400/60"
        }`}
      >
        <span className={`text-xs font-semibold uppercase tracking-wide ${colorTexto}`}>
          {!tieneRecibido ? "Escribe cuánto te entregó" : !completo ? "⚠ Faltan" : exacto ? "✓ Pago exacto" : "↩ Vuelta a entregar"}
        </span>
        <span className={`text-2xl font-bold ${colorTexto}`}>
          {!tieneRecibido ? "—" : exacto ? "Sin vuelta" : formatMoney(Math.abs(vuelta))}
        </span>
      </div>
    </div>
  );
}
