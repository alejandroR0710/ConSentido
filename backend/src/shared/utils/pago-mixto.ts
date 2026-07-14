export type PagoInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

/**
 * "Mixto" no es un método de pago real en la base (movimientos_caja/pagos solo
 * aceptan 'efectivo' o 'banco'): es una comodidad de UI que, al cobrar, se
 * descompone en 1 o 2 líneas ya puras (una por método), cada una insertada
 * como su propio movimiento/pago. Si alguno de los dos montos es 0, esa línea
 * simplemente no se genera (mixto con $0 en un lado equivale a pago simple).
 */
export function descomponerPago(input: PagoInput): { metodoPago: "efectivo" | "banco"; monto: number }[] {
  if (input.metodoPago === "mixto") {
    const partes: { metodoPago: "efectivo" | "banco"; monto: number }[] = [];
    if (input.montoEfectivo > 0) partes.push({ metodoPago: "efectivo", monto: input.montoEfectivo });
    if (input.montoBanco > 0) partes.push({ metodoPago: "banco", monto: input.montoBanco });
    return partes;
  }
  return [{ metodoPago: input.metodoPago, monto: input.monto }];
}
