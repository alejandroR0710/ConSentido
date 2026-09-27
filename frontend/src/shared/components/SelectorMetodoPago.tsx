import { formatMoney } from "../format/money";
import { MoneyInput } from "./MoneyInput";

// `referenciaBanco`: últimos 4 caracteres del ID de la transferencia. El
// backend la exige en todo pago recibido que lleve algo por banco.
export type MetodoPagoValor =
  | { metodoPago: "efectivo" | "banco"; referenciaBanco?: string }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number; referenciaBanco?: string };

const REFERENCIA_BANCO_REGEX = /^[A-Z0-9]{4}$/;

function llevaBanco(pago: MetodoPagoValor) {
  return pago.metodoPago === "banco" || (pago.metodoPago === "mixto" && pago.montoBanco > 0);
}

/** true si el pago lleva algo por banco y todavía no tiene los 4 caracteres
 *  de la transferencia — para deshabilitar el botón de cobrar. */
export function faltaReferenciaBanco(pago: MetodoPagoValor) {
  const valida = REFERENCIA_BANCO_REGEX.test(pago.referenciaBanco ?? "");
  // A medio escribir tampoco sirve (el backend rechaza el formato), aunque el
  // mixto todavía no tenga monto en banco.
  return (llevaBanco(pago) && !valida) || (Boolean(pago.referenciaBanco) && !valida);
}

/** Lo que hay que sumarle al cuerpo del pago que se manda al backend. */
export function referenciaBancoPayload(pago: MetodoPagoValor): { referenciaBanco?: string } {
  return llevaBanco(pago) && pago.referenciaBanco ? { referenciaBanco: pago.referenciaBanco } : {};
}

interface SelectorMetodoPagoProps {
  value: MetodoPagoValor;
  onChange: (value: MetodoPagoValor) => void;
  /** Si se conoce de antemano el total a repartir (ej. el total de una orden o
   *  de una parte de la cuenta ya calculado), se muestra cuánto llevan sumado
   *  los dos montos mientras el cajero reparte — así sabe si falta o sobra. */
  totalFijo?: number;
  /** Pide los últimos 4 del ID de la transferencia al elegir Banco/Mixto.
   *  Solo en pagos que se RECIBEN — los egresos lo apagan. */
  pedirReferenciaBanco?: boolean;
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
export function SelectorMetodoPago({ value, onChange, totalFijo, pedirReferenciaBanco = true }: SelectorMetodoPagoProps) {
  const sumaMixta = value.metodoPago === "mixto" ? value.montoEfectivo + value.montoBanco : 0;
  const cuadra = totalFijo === undefined || Math.abs(sumaMixta - totalFijo) < 0.01;
  const mostrarReferencia = pedirReferenciaBanco && value.metodoPago !== "efectivo";
  const referencia = value.referenciaBanco ?? "";
  const referenciaIncompleta = pedirReferenciaBanco && faltaReferenciaBanco(value);
  const bancoRequerido = llevaBanco(value);

  function seleccionar(metodo: MetodoPagoValor["metodoPago"]) {
    // La referencia ya escrita se conserva al cambiar entre Banco y Mixto; en
    // Efectivo no aplica y se descarta.
    const referenciaBanco = metodo === "efectivo" ? undefined : value.referenciaBanco;
    onChange(
      metodo === "mixto"
        ? { metodoPago: "mixto", montoEfectivo: totalFijo ?? 0, montoBanco: 0, referenciaBanco }
        : { metodoPago: metodo, referenciaBanco },
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
        // Mismos colores de estado que el campo de referencia: ámbar mientras
        // efectivo + banco no suman el total, verde cuando cuadra. Sin total
        // conocido (totalFijo) no hay contra qué comparar y queda neutro.
        <div
          className={`flex flex-col gap-2 rounded-lg border-2 p-3 ${
            totalFijo === undefined
              ? "border-brand-vanilla-dark dark:border-brand-green-700"
              : cuadra
                ? "border-brand-green-600 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-700/20"
                : "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
          }`}
        >
          <span className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">🔀 ¿Cuánto paga en cada método?</span>
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
            <p
              className={`text-xs font-medium ${
                cuadra ? "text-brand-green-700 dark:text-brand-vanilla" : "text-amber-700 dark:text-amber-400"
              }`}
            >
              {cuadra
                ? `✓ Cuadra: ${formatMoney(value.montoEfectivo)} efectivo + ${formatMoney(value.montoBanco)} banco = ${formatMoney(totalFijo)}`
                : sumaMixta < totalFijo
                  ? `Faltan ${formatMoney(totalFijo - sumaMixta)} por repartir (llevas ${formatMoney(sumaMixta)} de ${formatMoney(totalFijo)}).`
                  : `Sobran ${formatMoney(sumaMixta - totalFijo)}: entre los dos deben sumar exacto ${formatMoney(totalFijo)}.`}
            </p>
          )}
        </div>
      )}

      {mostrarReferencia && (
        <label
          className={`flex flex-col gap-2 rounded-lg border-2 p-3 ${
            referenciaIncompleta
              ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
              : referencia.length === 4
                ? "border-brand-green-600 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-700/20"
                : "border-brand-vanilla-dark dark:border-brand-green-700"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
            <span aria-hidden>🏦</span> Referencia de la transferencia
            {bancoRequerido && <span className="text-xs font-normal text-red-600 dark:text-red-400">(obligatorio)</span>}
          </span>
          <span className="text-xs leading-snug text-brand-ink/75 dark:text-brand-vanilla/75">
            Pídele al cliente el comprobante del pago (Nequi, Bancolombia, Daviplata, etc.) y escribe los{" "}
            <strong>últimos 4 caracteres</strong> del número de referencia o ID de la transacción. Pueden ser letras,
            números o las dos cosas.
          </span>
          <span className="text-xs leading-snug text-brand-ink/60 dark:text-brand-vanilla/60">
            Sirve para comprobar después, contra el extracto del banco, que el pago sí llegó.
            {value.metodoPago === "mixto" &&
              (value.montoBanco > 0
                ? ` Aplica a los ${formatMoney(value.montoBanco)} que se pagan por banco.`
                : " Solo se pide si una parte se paga por banco.")}
          </span>
          <input
            value={referencia}
            onChange={(e) =>
              onChange({
                ...value,
                referenciaBanco: e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4),
              })
            }
            placeholder="Ej: 7A2F"
            // Sin maxLength a propósito: el navegador cortaría lo pegado ANTES
            // de quitar guiones/espacios ("7a-2f9" quedaría "7A2"). El límite de
            // 4 ya lo aplica el onChange, después de limpiar.
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={`${claseMonto} font-mono tracking-[0.3em] uppercase`}
          />
          {referenciaIncompleta ? (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              {referencia.length === 0
                ? "Escribe los 4 caracteres para poder registrar el pago."
                : `Faltan ${4 - referencia.length} de 4 caracteres.`}
            </span>
          ) : (
            referencia.length === 4 && (
              <span className="text-xs font-medium text-brand-green-700 dark:text-brand-vanilla">
                ✓ Referencia completa: {referencia}
              </span>
            )
          )}
        </label>
      )}
    </div>
  );
}
