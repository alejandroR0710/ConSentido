/** Formatea un valor monetario como "$22.000": símbolo $, separador de miles
 *  (punto) a partir de los mil, sin decimales (los precios del negocio son
 *  siempre en pesos enteros). */
export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

/** Redondea al múltiplo de 100 más cercano (ej. 27.715 → 27.700, 27.765 →
 *  27.800) — usado para la propina calculada por porcentaje, que si no
 *  queda en un número feo tipo "$27.715" en vez de "$27.700". */
export function redondearA100(value: number): number {
  return Math.round(value / 100) * 100;
}
