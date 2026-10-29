import { descomponerPago, PagoInput } from "./pago-mixto";

export type LineaArea = { moduloOrigenSlug: string; monto: number };
export type FilaAreaMetodo = { moduloOrigenSlug: string; metodoPago: "efectivo" | "banco"; monto: number };

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Reparte un pago entre varias áreas (moduloOrigenSlug) y, dentro de cada área,
 * entre métodos efectivo/banco, de modo que las sumas den EXACTO:
 *  - por área: la suma de sus filas = monto de esa área;
 *  - por método: la suma de las filas 'efectivo' = montoEfectivo del pago, y
 *    la de 'banco' = montoBanco (o el monto total, si el pago no es mixto).
 *
 * Algoritmo (en cascada): las áreas se toman en orden de aparición; cada área
 * salvo la última recibe su parte proporcional de efectivo (redondeada a
 * centavos) y el resto de su monto va a banco. La última área absorbe el
 * residuo de efectivo (efectivo del pago − lo ya asignado) y su banco es lo que
 * le queda de su monto, así ambos marginales cuadran exacto.
 *
 * Cada área se descompone con `descomponerPago` (pago-mixto.ts). Áreas con monto
 * 0 no generan fila.
 */
export function descomponerPorAreaYMetodo(lineas: LineaArea[], pago: PagoInput): FilaAreaMetodo[] {
  const porArea = new Map<string, number>();
  for (const l of lineas) {
    porArea.set(l.moduloOrigenSlug, centavos((porArea.get(l.moduloOrigenSlug) ?? 0) + l.monto));
  }
  const grupos = [...porArea].filter(([, monto]) => monto > 0);
  const totalLineas = centavos(grupos.reduce((s, [, monto]) => s + monto, 0));

  if (pago.metodoPago !== "mixto") {
    if (totalLineas !== centavos(pago.monto)) {
      throw new Error(`descomponerPorAreaYMetodo: la suma de áreas (${totalLineas}) no cuadra con el pago (${pago.monto})`);
    }
    return grupos.map(([moduloOrigenSlug]) => ({
      moduloOrigenSlug,
      metodoPago: pago.metodoPago,
      monto: porArea.get(moduloOrigenSlug)!,
    }));
  }

  const efectivoTotal = pago.montoEfectivo;
  const total = centavos(pago.montoEfectivo + pago.montoBanco);
  if (totalLineas !== total) {
    throw new Error(`descomponerPorAreaYMetodo: la suma de áreas (${totalLineas}) no cuadra con el pago (${total})`);
  }

  const filas: FilaAreaMetodo[] = [];
  let efectivoRestante = efectivoTotal;
  grupos.forEach(([moduloOrigenSlug, monto], idx) => {
    const esUltima = idx === grupos.length - 1;
    const efectivo = esUltima ? centavos(efectivoRestante) : centavos((monto * efectivoTotal) / total);
    const banco = centavos(monto - efectivo);
    if (efectivo < 0 || banco < 0) {
      throw new Error(`descomponerPorAreaYMetodo: reparto negativo para el área ${moduloOrigenSlug}`);
    }
    efectivoRestante = centavos(efectivoRestante - efectivo);
    for (const parte of descomponerPago({ metodoPago: "mixto", montoEfectivo: efectivo, montoBanco: banco })) {
      filas.push({ moduloOrigenSlug, ...parte });
    }
  });
  return filas;
}
