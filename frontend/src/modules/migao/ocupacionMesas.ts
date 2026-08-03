import type { Mesa, OrdenResumen } from "./api";

export interface MesaConOcupacion extends Mesa {
  /** Órdenes abiertas que ocupan esta mesa ahora mismo — puede haber más de
   *  una a la vez (ej. una mesa grande con varios comensales, cada uno con su
   *  propia cuenta). Vacío = mesa libre. La ocupación se calcula siempre en
   *  vivo cruzando con las órdenes abiertas — nunca se guarda en
   *  `mesas.estado` (ver migao.repository.ts), para que no se desincronice. */
  ordenes: OrdenResumen[];
}

export function combinarMesasConOrdenes(mesas: Mesa[], ordenes: OrdenResumen[]): MesaConOcupacion[] {
  return mesas.map((mesa) => ({
    ...mesa,
    ordenes: ordenes.filter((o) => o.mesa_id === mesa.id),
  }));
}
