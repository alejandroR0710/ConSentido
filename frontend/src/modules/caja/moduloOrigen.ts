import type { ModuloOrigenSlug } from "./api";

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
