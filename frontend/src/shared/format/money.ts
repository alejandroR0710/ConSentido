/** Formatea un valor monetario como "$22.000": símbolo $, separador de miles
 *  (punto) a partir de los mil, sin decimales (los precios del negocio son
 *  siempre en pesos enteros). */
export function formatMoney(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}
