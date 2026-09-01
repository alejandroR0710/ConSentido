import type { ModuloOrigenSlug, MovimientoCaja } from "./api";

/** Un pago mixto se guarda como 2 movimientos ya con método puro (ver
 *  backend caja.service.ts::insertarMovimientosIngreso) — esto reconstruye
 *  la etiqueta "Mixta · efectivo"/"Mixta · banco" para mostrarlo en los
 *  historiales, sin que ningún cálculo tenga que dejar de usar el método puro. */
export function labelMetodoPago(m: Pick<MovimientoCaja, "metodo_pago" | "es_pago_mixto">): string {
  return m.es_pago_mixto ? `Mixta · ${m.metodo_pago}` : m.metodo_pago;
}

// Con Sentido primero a propósito: es el origen más común de un ingreso
// registrado a mano desde acá (Migao casi siempre cobra desde su propia
// pantalla) — varios formularios usan MODULOS_ORIGEN[0] como valor por
// defecto, así que el orden decide qué área queda pre-seleccionada.
export const MODULOS_ORIGEN: { value: ModuloOrigenSlug; label: string; icon: string }[] = [
  { value: "con_sentido", label: "Con Sentido", icon: "🎨" },
  { value: "migao", label: "Migao (POS)", icon: "🍽️" },
  { value: "talleres", label: "Talleres", icon: "🔧" },
  { value: "pedidos", label: "Pedidos", icon: "🚚" },
  { value: "insumos", label: "Insumos", icon: "📦" },
  { value: "general", label: "General", icon: "📊" },
];

export const LABEL_POR_MODULO_SLUG: Record<string, string> = Object.fromEntries(
  MODULOS_ORIGEN.map((m) => [m.value, m.label]),
);

/** Agrupa movimientos de un tipo (ingreso/egreso) sumando por su origen (área
 *  o categoría de gasto), para mostrar de qué se compone el total — no solo
 *  la suma. Usado tanto para el desglose en pantalla como para armar el
 *  resumen imprimible de un día/turno (ver caja/factura.ts). */
export function agruparPorEtiqueta(movimientos: MovimientoCaja[], tipo: "ingreso" | "egreso") {
  const porEtiqueta = new Map<string, number>();
  for (const m of movimientos) {
    if (m.tipo !== tipo) continue;
    const etiqueta =
      tipo === "ingreso"
        ? (m.modulo_origen_slug ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug) : "Otro")
        : (m.categoria_gasto_nombre ?? "Otro");
    porEtiqueta.set(etiqueta, (porEtiqueta.get(etiqueta) ?? 0) + Number(m.monto));
  }
  return Array.from(porEtiqueta.entries()).sort((a, b) => b[1] - a[1]);
}

/** Igual que `agruparPorEtiqueta`, pero además desglosa cuánto de cada
 *  etiqueta entró en efectivo vs. banco — usado en el resumen del día del
 *  calendario de Historial de Caja, donde no basta con saber cuánto reunió
 *  cada área sino en qué se recibió. */
export function agruparPorEtiquetaConMetodo(movimientos: MovimientoCaja[], tipo: "ingreso" | "egreso") {
  const porEtiqueta = new Map<string, { total: number; efectivo: number; banco: number }>();
  for (const m of movimientos) {
    if (m.tipo !== tipo) continue;
    const etiqueta =
      tipo === "ingreso"
        ? (m.modulo_origen_slug ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug) : "Otro")
        : (m.categoria_gasto_nombre ?? "Otro");
    const actual = porEtiqueta.get(etiqueta) ?? { total: 0, efectivo: 0, banco: 0 };
    const monto = Number(m.monto);
    actual.total += monto;
    if (m.metodo_pago === "efectivo") actual.efectivo += monto;
    else actual.banco += monto;
    porEtiqueta.set(etiqueta, actual);
  }
  return Array.from(porEtiqueta.entries())
    .map(([etiqueta, datos]) => ({ etiqueta, ...datos }))
    .sort((a, b) => b.total - a.total);
}
