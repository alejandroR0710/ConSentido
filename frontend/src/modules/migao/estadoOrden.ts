import type { ItemActivo } from "./api";

export type EstadoAgregadoOrden = "pendiente" | "preparando" | "listo";

/** Estado global de una orden a partir de sus ítems todavía activos (pendiente/
 *  preparando/listo — servido/cancelado ya no aparecen en `itemsActivos`): si
 *  queda algo pendiente, la orden sigue "en espera"; si no, pero queda algo en
 *  preparando, sigue "en preparación"; si no queda ninguno de los dos, todo lo
 *  que sigue activo ya está "listo". `null` = sin ítems activos (nada para
 *  mostrar, ej. todo ya fue entregado). Compartido entre Mesero y Cajero. */
export function estadoAgregadoOrden(ordenId: string, activos: ItemActivo[]): EstadoAgregadoOrden | null {
  const items = activos.filter((i) => i.orden_id === ordenId);
  if (items.length === 0) return null;
  if (items.some((i) => i.estado === "pendiente")) return "pendiente";
  if (items.some((i) => i.estado === "preparando")) return "preparando";
  return "listo";
}

export const BORDE_POR_ESTADO: Record<EstadoAgregadoOrden, string> = {
  pendiente: "border-2 border-slate-400 dark:border-slate-500",
  preparando: "border-2 border-amber-500",
  listo: "border-4 border-brand-green-600 dark:border-brand-green-500",
};

export const FILA_POR_ESTADO: Record<EstadoAgregadoOrden, string> = {
  pendiente: "border-l-4 border-slate-400",
  preparando: "border-l-4 border-amber-500 bg-amber-50/50 dark:bg-amber-950/10",
  listo: "border-l-4 border-brand-green-600 bg-brand-green-50/50 dark:bg-brand-green-700/10",
};

export const ETIQUETA_POR_ESTADO: Record<EstadoAgregadoOrden, string> = {
  pendiente: "En espera",
  preparando: "Preparando",
  listo: "Lista",
};

export const BADGE_POR_ESTADO: Record<EstadoAgregadoOrden, string> = {
  pendiente: "bg-slate-400 text-white",
  preparando: "bg-amber-500 text-white",
  listo: "bg-brand-green-600 text-brand-vanilla",
};
