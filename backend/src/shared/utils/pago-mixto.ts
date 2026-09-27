import { z } from "zod";
import { Errors } from "./app-error";

/**
 * Últimos 4 caracteres del ID de la transferencia (letras y/o números) —
 * obligatorio en todo pago RECIBIDO que tenga una parte por banco, para poder
 * cruzarlo con el extracto del banco (ver exigirReferenciaBanco). Se guarda en
 * movimientos_caja.referencia_banco, solo en la línea 'banco'.
 */
export const referenciaBancoSchema = {
  referenciaBanco: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4}$/, "La referencia del banco deben ser exactamente 4 letras o números")
    .transform((v) => v.toUpperCase())
    .optional(),
};

/** Exige la referencia de la transferencia cuando el pago lleva algo por
 *  banco (`montoEnBanco` > 0). Devuelve el valor listo para guardar en la
 *  línea 'banco', o undefined si no hay nada por banco. */
export function exigirReferenciaBanco(montoEnBanco: number, referenciaBanco: string | undefined): string | undefined {
  if (montoEnBanco <= 0) return undefined;
  if (!referenciaBanco) {
    throw Errors.badRequest("Escribe los últimos 4 dígitos del ID de la transferencia para registrar el pago por banco");
  }
  return referenciaBanco;
}

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

/**
 * Exige y valida "cuánto entregó el cliente en efectivo" siempre que un pago
 * mueva plata física — obligatorio para poder calcular y dejar registrado
 * (ver migao.repository.ts::crearPago / caja.repository.ts::crearPagoParaVenta)
 * cuánto se le devolvió de vuelta. `montoEnEfectivo` es la parte del cobro que
 * de verdad va en efectivo (el total si el método es 'efectivo' puro, o
 * `montoEfectivo` si es mixto); si es 0 (pago 100% banco, o mixto sin nada en
 * efectivo) no hay nada que exigir. Devuelve el valor ya validado, listo para
 * pasarlo a la línea 'efectivo' del pago. Usado tanto por Migao (cerrar
 * orden/pagar ítems/abonos) como por el ingreso manual de Caja General.
 */
export function exigirMontoRecibidoEfectivo(
  montoEnEfectivo: number,
  montoRecibidoEfectivo: number | undefined,
): number | undefined {
  if (montoEnEfectivo <= 0) return undefined;
  if (montoRecibidoEfectivo == null || montoRecibidoEfectivo < montoEnEfectivo - 0.01) {
    throw Errors.badRequest(
      `Indica cuánto te entregó el cliente en efectivo (al menos ${montoEnEfectivo}) para calcular la vuelta`,
    );
  }
  return montoRecibidoEfectivo;
}
