import type { ModuloOrigenSlug } from "./api";

export const MODULOS_ORIGEN: { value: ModuloOrigenSlug; label: string }[] = [
  { value: "migao", label: "Migao (POS)" },
  { value: "con_sentido", label: "Con Sentido" },
  { value: "talleres", label: "Talleres" },
  { value: "pedidos", label: "Pedidos" },
  { value: "insumos", label: "Insumos" },
  { value: "general", label: "General" },
];

export const LABEL_POR_MODULO_SLUG: Record<string, string> = Object.fromEntries(
  MODULOS_ORIGEN.map((m) => [m.value, m.label]),
);
