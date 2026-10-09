import { formatMoney } from "../../shared/format/money";

// Precio mayorista en la caja (mismo criterio que la tienda, ver spec 2026-10-09 del e-commerce):
// se suman las líneas del mismo producto del e-commerce (`grupo`: sus variantes); si llegan al
// mínimo, cada línea pasa al menor entre su precio normal y el mayorista. Una línea con precio
// editado a mano (o de texto libre) no se toca, pero sus unidades sí cuentan para el mínimo.
export interface LineaMayorista {
  grupo: string | null;
  cantidad: number;
  precioNormal: number;
  precioMayorista: number | null;
  mayoristaDesde: number | null;
  precioManual: boolean;
}

/** Por línea: el precio que corresponde (null = no tocar el que tiene) y si es el mayorista. */
export function preciosConMayorista(lineas: LineaMayorista[]): { precio: number | null; esMayorista: boolean }[] {
  const totales = new Map<string, number>();
  for (const l of lineas) if (l.grupo) totales.set(l.grupo, (totales.get(l.grupo) ?? 0) + l.cantidad);

  return lineas.map((l) => {
    if (!l.grupo || l.precioManual) return { precio: null, esMayorista: false };
    const alcanza =
      l.precioMayorista != null && l.mayoristaDesde != null && (totales.get(l.grupo) ?? 0) >= l.mayoristaDesde;
    if (alcanza && l.precioMayorista! < l.precioNormal) return { precio: l.precioMayorista!, esMayorista: true };
    return { precio: l.precioNormal, esMayorista: false };
  });
}

/** "Mayorista $8.000 desde 12" (buscador / autocompletar); null sin mayorista. */
export function textoMayorista(p: { precio_mayorista: number | null; mayorista_desde: number | null }): string | null {
  if (p.precio_mayorista == null || p.mayorista_desde == null) return null;
  return `Mayorista ${formatMoney(p.precio_mayorista)} desde ${p.mayorista_desde}`;
}
