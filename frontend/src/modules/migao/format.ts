/** Postgres NUMERIC vuelve como texto ("1.000"); esto lo muestra como "1" o "1.5", sin ceros de más. */
export function formatCantidad(cantidad: string | number): string {
  return Number(cantidad).toString();
}
