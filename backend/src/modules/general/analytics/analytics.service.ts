import * as repo from "./analytics.repository";

/**
 * Analíticas de Migao (prioridad actual): pedidos, ganancias, comensales/
 * clientes, desempeño por mesero, y tiempos de Cocina/entrega. Los demás
 * módulos (Insumos, Talleres, Con Sentido, Pedidos) todavía no tienen datos
 * operativos reales que analizar — se agregan cuando existan.
 */
export async function obtenerAnalyticsMigao(desde: string, hasta: string) {
  const [pedidos, ganancias, meseros, cocina, entrega] = await Promise.all([
    repo.getResumenPedidos(desde, hasta),
    repo.getGanancias(desde, hasta),
    repo.getParametrosMeseros(desde, hasta),
    repo.getParametrosCocina(desde, hasta),
    repo.getTiempoEntrega(desde, hasta),
  ]);

  const ingresos = Number(ganancias.ingresos);
  const costos = Number(ganancias.costos);

  return {
    pedidos: {
      cerradas: Number(pedidos.cerradas),
      canceladas: Number(pedidos.canceladas),
      comensales: Number(pedidos.comensales),
      clientesUnicos: Number(pedidos.clientes_unicos),
    },
    ganancias: {
      ingresos,
      costos,
      ganancia: ingresos - costos,
      itemsVendidos: Number(ganancias.items_vendidos),
    },
    meseros: meseros.map((m) => ({
      meseroId: m.mesero_id,
      meseroNombre: m.mesero_nombre,
      ordenes: Number(m.ordenes),
      totalVendido: Number(m.total_vendido),
      tiempoPromedioMin: m.tiempo_promedio_min !== null ? Number(m.tiempo_promedio_min) : null,
      canceladas: Number(m.canceladas),
    })),
    cocina: {
      itemsPreparados: Number(cocina.items_preparados),
      tiempoPromedioMin: cocina.tiempo_promedio_min !== null ? Number(cocina.tiempo_promedio_min) : null,
    },
    entrega: {
      itemsEntregados: Number(entrega.items_entregados),
      tiempoPromedioMin: entrega.tiempo_promedio_min !== null ? Number(entrega.tiempo_promedio_min) : null,
    },
  };
}
