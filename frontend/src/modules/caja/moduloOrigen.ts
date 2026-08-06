import type { ModuloOrigenSlug, MovimientoCaja } from "./api";

export const MODULOS_ORIGEN: { value: ModuloOrigenSlug; label: string; icon: string }[] = [
  { value: "migao", label: "Migao (POS)", icon: "🍽️" },
  { value: "con_sentido", label: "Con Sentido", icon: "🎨" },
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
