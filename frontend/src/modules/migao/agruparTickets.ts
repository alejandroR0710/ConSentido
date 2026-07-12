import type { ItemCocina } from "./api";

export interface Ticket {
  ordenId: string;
  mesaNumero: string;
  mesaPiso: number | null;
  meseroNombre: string | null;
  items: ItemCocina[];
}

/** Un ticket por orden (no por mesa): más simple de escanear, patrón estándar
 *  de kitchen-display. Compartido entre la cola activa de Cocina y su historial
 *  de despachados. El primer ítem de cada uno ya viene ordenado por
 *  `created_at`, así que los tickets quedan en ese mismo orden. */
export function agruparPorOrden(items: ItemCocina[]): Ticket[] {
  const tickets = new Map<string, Ticket>();
  for (const item of items) {
    let ticket = tickets.get(item.orden_id);
    if (!ticket) {
      ticket = {
        ordenId: item.orden_id,
        mesaNumero: item.mesa_numero ?? "Sin mesa",
        mesaPiso: item.mesa_piso,
        meseroNombre: item.mesero_nombre,
        items: [],
      };
      tickets.set(item.orden_id, ticket);
    }
    ticket.items.push(item);
  }
  return Array.from(tickets.values());
}
