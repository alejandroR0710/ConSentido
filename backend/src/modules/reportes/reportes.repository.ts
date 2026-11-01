export const MODULOS_ALCANCE_SLUGS = ["insumos", "con_sentido", "talleres", "general", "pedidos"] as const;

export const MODULOS_ALCANCE_SUBQUERY =
  "(SELECT id FROM modulos WHERE slug IN ('insumos','con_sentido','talleres','general','pedidos'))";
