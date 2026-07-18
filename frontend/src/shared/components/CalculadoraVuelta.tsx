import { formatMoney } from "../format/money";
import { MoneyInput } from "./MoneyInput";

/** Ayuda mental para el cajero: cuánto dio el cliente y cuánto hay que
 *  devolverle. Es puramente informativa — no se manda al backend, el monto
 *  cobrado/registrado en efectivo sigue siendo el total (o la parte) a pagar,
 *  no lo que el cliente entregó en mano. Solo aplica cuando hay efectivo de
 *  por medio (en Caja Migao al cobrar, y en Caja General al registrar un
 *  ingreso manual en efectivo). */
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
  return (
    <div className="flex items-center gap-2 rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
      <span className="w-16 shrink-0 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">Recibí</span>
      <MoneyInput
        value={recibido}
        onChange={onChange}
        className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />
      <span
        className={`w-32 shrink-0 text-right text-sm font-semibold ${
          recibido <= 0
            ? "text-brand-ink/40 dark:text-brand-vanilla/40"
            : vuelta < 0
              ? "text-red-600"
              : "text-brand-green-700 dark:text-brand-vanilla"
        }`}
      >
        {recibido <= 0 ? "—" : vuelta < 0 ? `Falta ${formatMoney(-vuelta)}` : `Vuelta ${formatMoney(vuelta)}`}
      </span>
    </div>
  );
}
