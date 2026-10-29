/** Reparte `total` en `n` montos iguales — la última parte absorbe el
 *  residuo del redondeo, así la suma de todas siempre da EXACTO el total
 *  (nunca queda 1 centavo suelto). Usada al crear las partes (calcularPartes)
 *  y al recalcularlas en vivo (recalcularVentaDesdeOrden). */
export function distribuirIgual(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  const montos = Array.from({ length: n }, () => base);
  montos[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100;
  return montos;
}
