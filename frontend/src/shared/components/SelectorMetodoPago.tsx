import { formatMoney } from "../format/money";
import { MoneyInput } from "./MoneyInput";

export type MetodoPagoValor =
  | { metodoPago: "efectivo" | "banco" }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

interface SelectorMetodoPagoProps {
  value: MetodoPagoValor;
  onChange: (value: MetodoPagoValor) => void;
  /** Si se conoce de antemano el total a repartir (ej. el total de una orden o
   *  de una parte de la cuenta ya calculado), se muestra cuánto llevan sumado
   *  los dos montos mientras el cajero reparte — así sabe si falta o sobra. */
  totalFijo?: number;
}

const claseMonto =
  "flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

const METODOS: { valor: MetodoPagoValor["metodoPago"]; label: string; icono: string }[] = [
  { valor: "efectivo", label: "Efectivo", icono: "💵" },
  { valor: "banco", label: "Banco", icono: "🏦" },
  { valor: "mixto", label: "Mixto", icono: "🔀" },
];

/**
 * "Mixto" no es un método de pago real (la base solo acepta efectivo/banco por
 * línea): es una comodidad para el caso de un cliente que paga parte en
 * efectivo y parte en banco. El backend lo descompone en 1-2 movimientos ya
 * puros — este selector solo recolecta esos dos montos.
 */
export function SelectorMetodoPago({ value, onChange, totalFijo }: SelectorMetodoPagoProps) {
  const sumaMixta = value.metodoPago === "mixto" ? value.montoEfectivo + value.montoBanco : 0;
  const cuadra = totalFijo === undefined || Math.abs(sumaMixta - totalFijo) < 0.01;

  function seleccionar(metodo: MetodoPagoValor["metodoPago"]) {
    onChange(
      metodo === "mixto"
        ? { metodoPago: "mixto", montoEfectivo: totalFijo ?? 0, montoBanco: 0 }
        : { metodoPago: metodo },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {METODOS.map((m) => {
          const activo = value.metodoPago === m.valor;
          return (
            <button
              key={m.valor}
              type="button"
              onClick={() => seleccionar(m.valor)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-xs font-medium transition-colors ${
                activo
                  ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                  : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {m.icono}
              </span>
              {m.label}
            </button>
          );
        })}
      </div>

      {value.metodoPago === "mixto" && (
        <div className="flex flex-col gap-2 rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">Efectivo</span>
            <MoneyInput
              value={value.montoEfectivo}
              onChange={(monto) => onChange({ ...value, montoEfectivo: monto })}
              className={claseMonto}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">Banco</span>
            <MoneyInput
              value={value.montoBanco}
              onChange={(monto) => onChange({ ...value, montoBanco: monto })}
              className={claseMonto}
            />
          </div>
          {totalFijo !== undefined && (
            <p className={`text-xs ${cuadra ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"}`}>
              {formatMoney(sumaMixta)} de {formatMoney(totalFijo)}
              {!cuadra && " — debe cuadrar exacto"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
