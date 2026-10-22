import { formatMoney } from "../../../shared/format/money";
import { formatCantidad } from "../format";
import type { CuentaParte, OrdenItem } from "../api";

interface ResumenCuentasParteProps {
  parte: CuentaParte;
  // Lo que el cajero tiene escrito AHORA en "¿Cuánto se paga ahora?" — se
  // muestra en vivo para que quede claro que ese monto cubre las DOS
  // cuentas a la vez (reparto proporcional, lo calcula el backend).
  montoPagarAhora: number;
  // Cuando la cuenta tiene varias partes, el panel lateral apila el
  // resumen de cada una — sin esto quedarían indistinguibles entre sí.
  indice?: number;
  // Productos de la orden completa — se listan bajo "Cuenta de la mesa"
  // salvo que esta parte ya tenga su propio desglose (modo "producto",
  // parte.unidades), en cuyo caso se listan esos en su lugar.
  itemsOrden?: OrdenItem[];
}

/** Panel resumen de las dos cuentas que conviven en una parte con un
 *  carrito de tienda vinculado — ver
 *  docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
 *  Pensado para ir al costado del formulario de abono, nunca reemplazarlo. */
export function ResumenCuentasParte({ parte, montoPagarAhora, indice, itemsOrden }: ResumenCuentasParteProps) {
  const tienda = parte.tienda!;
  const pendienteCombinado = parte.pendiente + tienda.pendiente;
  const itemsMesa =
    parte.unidades.length > 0
      ? parte.unidades.map((u) => ({ key: `u-${u.itemId}`, cantidad: u.cantidad, nombre: u.productoNombre }))
      : (itemsOrden ?? [])
          .filter((i) => i.estado !== "cancelado")
          .map((i) => ({ key: `i-${i.id}`, cantidad: Number(i.cantidad), nombre: i.producto_nombre }));

  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl border border-brand-vanilla-dark bg-brand-vanilla-dark p-3 dark:border-brand-green-600 dark:bg-brand-green-700">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
        {indice !== undefined ? `Resumen — Parte ${indice}` : "Resumen de esta parte"}
      </h4>

      <div className="flex flex-col gap-1 rounded-lg bg-brand-vanilla px-3 py-2 dark:bg-brand-green-900">
        <div className="flex items-center justify-between text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
          <span>🍽️ Cuenta de la mesa</span>
          <span>{formatMoney(parte.montoDebido)}</span>
        </div>
        {itemsMesa.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[11px] text-brand-ink/60 dark:text-brand-vanilla/60">
            {itemsMesa.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {formatCantidad(item.cantidad)}× {item.nombre}
                </span>
              </li>
            ))}
          </ul>
        )}
        {parte.montoPagado > 0 && (
          <div className="flex items-center justify-between text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
            <span>Ya pagado</span>
            <span>{formatMoney(parte.montoPagado)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
          <span>Pendiente</span>
          <span>{formatMoney(parte.pendiente)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg bg-brand-vanilla px-3 py-2 dark:bg-brand-green-900">
        <div className="flex items-center justify-between text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
          <span>🛍️ Cuenta de la tienda</span>
          <span>{formatMoney(tienda.monto)}</span>
        </div>
        <ul className="flex flex-col gap-0.5 text-[11px] text-brand-ink/60 dark:text-brand-vanilla/60">
          {tienda.items.map((item, idx) => (
            <li key={idx} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {formatCantidad(item.cantidad)}× {item.nombre}
              </span>
              <span className="shrink-0">{formatMoney(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        {tienda.descuentoPorcentaje > 0 && (
          <div className="flex items-center justify-between text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
            <span>Descuento {tienda.descuentoPorcentaje}%</span>
            <span>-{formatMoney(tienda.descuentoMonto)}</span>
          </div>
        )}
        {tienda.pagado > 0 && (
          <div className="flex items-center justify-between text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
            <span>Ya pagado</span>
            <span>{formatMoney(tienda.pagado)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
          <span>Pendiente</span>
          <span>{formatMoney(tienda.pendiente)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg bg-brand-green-600 px-3 py-2.5 text-brand-vanilla">
        <div className="flex items-center justify-between text-xs font-medium text-brand-vanilla/75">
          <span>Total pendiente</span>
          <span className="font-semibold">{formatMoney(pendienteCombinado)}</span>
        </div>
        {montoPagarAhora > 0 && (
          <div className="flex items-center justify-between border-t border-white/20 pt-1.5">
            <span className="text-base font-bold">💰 Vas a pagar ahora</span>
            <span className="text-2xl font-extrabold tracking-tight">{formatMoney(montoPagarAhora)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
