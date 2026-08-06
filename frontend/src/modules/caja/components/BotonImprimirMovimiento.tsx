import { useState } from "react";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import type { MovimientoCaja } from "../api";
import { movimientoAReciboProps } from "../factura";

interface BotonImprimirMovimientoProps {
  movimiento: MovimientoCaja;
  className?: string;
}

/** Comprobante de un movimiento que NO es una venta (egreso, ingreso manual,
 *  etc.) — a diferencia de BotonFactura no hace ninguna llamada a la API, el
 *  recibo se arma al vuelo con los datos que ya trae la fila. */
export function BotonImprimirMovimiento({ movimiento, className }: BotonImprimirMovimientoProps) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className={
          className ??
          "rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        }
      >
        Comprobante
      </button>
      {abierto && <ModalImprimir {...movimientoAReciboProps(movimiento)} onCerrar={() => setAbierto(false)} />}
    </>
  );
}
