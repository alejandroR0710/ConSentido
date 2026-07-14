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

const claseSelect =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const claseMonto =
  "flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

/**
 * "Mixto" no es un método de pago real (la base solo acepta efectivo/banco por
 * línea): es una comodidad para el caso de un cliente que paga parte en
 * efectivo y parte en banco. El backend lo descompone en 1-2 movimientos ya
 * puros — este selector solo recolecta esos dos montos.
 */
export function SelectorMetodoPago({ value, onChange, totalFijo }: SelectorMetodoPagoProps) {
  const sumaMixta = value.metodoPago === "mixto" ? value.montoEfectivo + value.montoBanco : 0;
  const cuadra = totalFijo === undefined || Math.abs(sumaMixta - totalFijo) < 0.01;

  return (
    <div className="flex flex-col gap-2">
      <select
        value={value.metodoPago}
        onChange={(e) => {
          const metodo = e.target.value as MetodoPagoValor["metodoPago"];
          onChange(
            metodo === "mixto"
              ? { metodoPago: "mixto", montoEfectivo: totalFijo ?? 0, montoBanco: 0 }
              : { metodoPago: metodo },
          );
        }}
        className={claseSelect}
      >
        <option value="efectivo">Efectivo</option>
        <option value="banco">Banco (tarjeta/transferencia)</option>
        <option value="mixto">Mixto (efectivo + banco)</option>
      </select>

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
