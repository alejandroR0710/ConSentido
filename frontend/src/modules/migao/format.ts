/** Postgres NUMERIC vuelve como texto ("1.000"); esto lo muestra como "1" o "1.5", sin ceros de más. */
export function formatCantidad(cantidad: string | number): string {
  return Number(cantidad).toString();
}

/** Tiempo transcurrido desde que se abrió una orden ("23 min" / "1h 05min") —
 *  usado en el badge de ocupación del plano de mesas de Caja Migao. */
export function formatDuracion(createdAtIso: string): string {
  const minutos = Math.max(0, Math.floor((Date.now() - new Date(createdAtIso).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, "0")}min`;
}
