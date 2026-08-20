// El campo interno se sigue llamando "piso" (API, columna de mesas) por no
// migrar nada solo por un cambio de nombre, pero ya no son pisos físicos:
// 1 y 2 son salones y 3 es el jardín. Este archivo centraliza esa traducción
// para que ningún componente muestre "salón 3" por error.
//
// Los colores son a propósito distintos de los que ya usa el estado de
// cocina (slate/amber/verde, ver estadoOrden.ts) y de cualquier color de
// alerta (rojo/ámbar) — son solo para identificar de un vistazo de qué
// espacio viene una cuenta, no para señalar urgencia.
export interface AreaMesa {
  valor: 1 | 2 | 3;
  label: string;
  icon: string;
  colorBorde: string;
  colorFondo: string;
  colorTexto: string;
}

export const AREAS_MESA: AreaMesa[] = [
  {
    valor: 1,
    label: "Salón 1",
    icon: "🏛️",
    colorBorde: "border-blue-400",
    colorFondo: "bg-blue-50 dark:bg-blue-950",
    colorTexto: "text-blue-700 dark:text-blue-300",
  },
  {
    valor: 3,
    label: "Jardín",
    icon: "🌿",
    colorBorde: "border-sky-400",
    colorFondo: "bg-sky-50 dark:bg-sky-950",
    colorTexto: "text-sky-700 dark:text-sky-400",
  },
  {
    valor: 2,
    label: "Salón 2",
    icon: "🏛️",
    colorBorde: "border-purple-400",
    colorFondo: "bg-purple-100 dark:bg-purple-900",
    colorTexto: "text-purple-700 dark:text-purple-400",
  },
];

export function labelArea(piso: number | null | undefined): string {
  if (piso == null) return "";
  return AREAS_MESA.find((a) => a.valor === piso)?.label ?? `Área ${piso}`;
}

export function areaDeMesa(piso: number | null | undefined): AreaMesa | undefined {
  if (piso == null) return undefined;
  return AREAS_MESA.find((a) => a.valor === piso);
}
