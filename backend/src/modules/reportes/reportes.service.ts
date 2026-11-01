import * as repo from "./reportes.repository";
import type { ResumenReporte, ResumenVentasPorMesFila } from "./reportes.types";

const LINEAS_NEGOCIO = ["insumos", "con_sentido", "talleres"] as const;

/**
 * Pivota las filas planas de `getVentasPorMes` (slug, mes, total) a una
 * matriz (filas = líneas de negocio + fila "total", columnas = meses
 * distintos encontrados en el histórico completo) — ver Bloque E del Spec.
 */
function pivotarVentasPorMes(filas: { slug: string; mes: string; total: string | number }[]) {
  const mesesSet = new Set<string>();
  const porLinea = new Map<string, Map<string, number>>(LINEAS_NEGOCIO.map((slug) => [slug, new Map<string, number>()]));

  for (const fila of filas) {
    mesesSet.add(fila.mes);
    porLinea.get(fila.slug)?.set(fila.mes, Number(fila.total));
  }

  const meses = [...mesesSet].sort();

  const filasMatriz: ResumenVentasPorMesFila[] = LINEAS_NEGOCIO.map((slug) => {
    const valoresLinea = porLinea.get(slug)!;
    return { slug, valores: Object.fromEntries(meses.map((mes) => [mes, valoresLinea.get(mes) ?? 0])) };
  });

  const filaTotal: ResumenVentasPorMesFila = {
    slug: "total",
    valores: Object.fromEntries(
      meses.map((mes) => [mes, filasMatriz.reduce((acum, fila) => acum + fila.valores[mes], 0)]),
    ),
  };

  return { meses, filas: [...filasMatriz, filaTotal] };
}

/**
 * Reporte "Resumen" — Bloques A-E. Es el reporte principal del módulo
 * (también usado por la exportación a Excel, Task 9), así que compone las
 * 4 queries independientes con `Promise.all`, siguiendo el patrón de
 * `analytics.service.ts`.
 */
export async function obtenerResumen(desde: string, hasta: string): Promise<ResumenReporte> {
  const [totalesRow, gastosPorCategoria, ingresosPorTipo, ventasPorMes] = await Promise.all([
    repo.getResumenTotales(desde, hasta),
    repo.getGastosPorCategoria(desde, hasta),
    repo.getIngresosPorTipo(desde, hasta),
    repo.getVentasPorMes(),
  ]);

  const ingresos_total = Number(totalesRow.ingresos_total);
  const gastos_total = Number(totalesRow.gastos_total);
  const ingresos_efectivo = Number(totalesRow.ingresos_efectivo);
  const ingresos_banco = Number(totalesRow.ingresos_banco);
  const gastos_efectivo = Number(totalesRow.gastos_efectivo);
  const gastos_banco = Number(totalesRow.gastos_banco);

  const utilidad = ingresos_total - gastos_total;
  const disponible_efectivo = ingresos_efectivo - gastos_efectivo;
  const disponible_banco = ingresos_banco - gastos_banco;
  const total_disponible = disponible_efectivo + disponible_banco;

  return {
    totales: {
      ingresos_total,
      gastos_total,
      utilidad,
      // No existen cuentas por pagar en el sistema (ver Spec/Brechas): dato
      // no disponible explícito, nunca inventado como 0.
      cuentas_por_pagar: null,
      utilidad_real_disponible: utilidad,
    },
    flujoPorMetodoPago: {
      ingresos_efectivo,
      ingresos_banco,
      gastos_efectivo,
      gastos_banco,
      disponible_efectivo,
      disponible_banco,
      total_disponible,
    },
    gastosPorCategoria: gastosPorCategoria.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      total: Number(g.total),
    })),
    ingresosPorTipo: ingresosPorTipo.map((i) => ({
      slug: i.slug,
      total: Number(i.total),
    })),
    ventasPorMes: pivotarVentasPorMes(ventasPorMes),
  };
}
