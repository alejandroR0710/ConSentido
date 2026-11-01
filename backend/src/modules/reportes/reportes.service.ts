import * as repo from "./reportes.repository";
import type {
  ResumenReporte,
  ResumenVentasPorMesFila,
  VentasFila,
  VentasFiltros,
  VentasPorDia,
  VentasReporte,
} from "./reportes.types";

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

/**
 * Reporte "Ventas" — concatena el detalle de producto (Paso 1) con los
 * ingresos sin línea propia (Paso 2), ordena por fecha, agrupa por día (la
 * "vista agrupada por día" del Spec) y calcula los totales del rango.
 *
 * `filtros.cliente` se recibe pero no se usa en ninguna de las dos queries:
 * `con_sentido_ventas`/`con_sentido_venta_items` no guardan ningún dato de
 * cliente (venta de mostrador — el propio documento de diseño lo anota:
 * "Cliente casi siempre vacío en mostrador, no es obligatorio en el
 * sistema"), así que no hay columna real contra la que filtrar. Se deja en
 * el esquema/tipo por si una fuente futura (Task 9 u otra) sí lo necesita.
 *
 * `total_efectivo`/`total_bancos` suman solo las filas con
 * `metodo_pago` exactamente `'efectivo'`/`'banco'` — una venta de
 * mostrador con `metodo_pago = 'mixto'` (pago repartido entre los dos) no
 * cae en ninguno de los dos, así que `total_efectivo + total_bancos` puede
 * quedar por debajo de `total_general` cuando hay ventas mixtas en el
 * rango. El brief solo fija como invariante que `total_general` cuadre
 * contra `ingresos_total` de Resumen (eso sí se cumple siempre, sin
 * importar el método) — partir el monto de una venta mixta entre
 * efectivo/banco por ítem requeriría prorratear con `monto_efectivo`/
 * `monto_banco` de la venta, que el Paso 1 del brief no pide traer.
 */
export async function obtenerVentas(filtros: VentasFiltros): Promise<VentasReporte> {
  const { desde, hasta, metodo, cliente, producto } = filtros;

  const [detalle, sinDetalle] = await Promise.all([
    repo.getVentasDetalle(desde, hasta, { metodo, cliente, producto }),
    repo.getIngresosSinDetalle(desde, hasta, { metodo }),
  ]);

  const filasDetalle: VentasFila[] = detalle.map((d) => ({
    tipo: "detalle",
    id: String(d.id),
    fecha: d.fecha,
    producto: d.producto,
    cantidad: Number(d.cantidad),
    precio_unitario: Number(d.precio_unitario),
    subtotal: Number(d.subtotal),
    metodo_pago: d.metodo_pago,
    area: d.area,
    consecutivo: d.consecutivo,
  }));

  const filasSinDetalle: VentasFila[] = sinDetalle.map((s) => ({
    tipo: "sin_detalle",
    id: String(s.id),
    fecha: s.fecha,
    producto: s.motivo,
    cantidad: null,
    precio_unitario: null,
    subtotal: Number(s.monto),
    metodo_pago: s.metodo_pago,
    area: s.area,
    consecutivo: null,
  }));

  const filas = [...filasDetalle, ...filasSinDetalle].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const porDiaMap = new Map<string, number>();
  for (const fila of filas) {
    porDiaMap.set(fila.fecha, (porDiaMap.get(fila.fecha) ?? 0) + fila.subtotal);
  }
  const porDia: VentasPorDia[] = [...porDiaMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, total]) => ({ fecha, total }));

  const total_general = filas.reduce((acc, f) => acc + f.subtotal, 0);
  const total_efectivo = filas
    .filter((f) => f.metodo_pago === "efectivo")
    .reduce((acc, f) => acc + f.subtotal, 0);
  const total_bancos = filas.filter((f) => f.metodo_pago === "banco").reduce((acc, f) => acc + f.subtotal, 0);

  return {
    filas,
    porDia,
    totales: { total_general, total_efectivo, total_bancos },
  };
}
