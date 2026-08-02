// El campo interno se sigue llamando "piso" (API, columna de mesas) por no
// migrar nada solo por un cambio de nombre, pero ya no son pisos físicos:
// 1 y 2 son salones y 3 es el jardín. Este archivo centraliza esa traducción
// para que ningún componente muestre "salón 3" por error.
export interface AreaMesa {
  valor: 1 | 2 | 3;
  label: string;
  icon: string;
}

export const AREAS_MESA: AreaMesa[] = [
  { valor: 1, label: "Salón 1", icon: "🏛️" },
  { valor: 2, label: "Salón 2", icon: "🏛️" },
  { valor: 3, label: "Jardín", icon: "🌿" },
];

export function labelArea(piso: number | null | undefined): string {
  if (piso == null) return "";
  return AREAS_MESA.find((a) => a.valor === piso)?.label ?? `Área ${piso}`;
}
