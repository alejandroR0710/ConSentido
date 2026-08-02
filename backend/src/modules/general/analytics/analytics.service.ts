import * as repo from "./analytics.repository";
import type { AnalyticsConSentido, AnalyticsInsumos, AnalyticsPedidos } from "./analytics.types";

/**
 * Analíticas generales: resumen de movimientos de caja por todas las áreas
 */
export async function obtenerAnalyticsGeneral(desde: string, hasta: string) {
  const movimientosPorModulo = await repo.getMovimientosPorModulo(desde, hasta);

  const total_ingresos = movimientosPorModulo.reduce((sum, m) => sum + Number(m.ingresos), 0);
  const total_egresos = movimientosPorModulo.reduce((sum, m) => sum + Number(m.egresos), 0);

  return {
    resumenGeneral: {
      ingresos_totales: total_ingresos,
      egresos_totales: total_egresos,
      saldo_neto: total_ingresos - total_egresos,
    },
    porModulo: movimientosPorModulo.map((m) => ({
      modulo_id: m.modulo_id,
      modulo_nombre: m.modulo_nombre,
      ingresos: Number(m.ingresos),
      egresos: Number(m.egresos),
      saldo_neto: Number(m.ingresos) - Number(m.egresos),
      efectivo: Number(m.efectivo),
      banco: Number(m.banco),
    })),
  };
}

/**
 * Analíticas de Migao (prioridad actual): pedidos, ganancias, comensales/
 * clientes, desempeño por mesero, y tiempos de Cocina/entrega. Los demás
 * módulos (Insumos, Talleres, Con Sentido, Pedidos) todavía no tienen datos
 * operativos reales que analizar — se agregan cuando existan.
 */
export async function obtenerAnalyticsMigao(desde: string, hasta: string) {
  const [pedidos, ganancias, ingresosPorMetodo, administrativo, meseros, cocina, entrega] = await Promise.all([
    repo.getResumenPedidos(desde, hasta),
    repo.getGanancias(desde, hasta),
    repo.getIngresosPorMetodoPago(desde, hasta),
    repo.getResumenAdministrativo(desde, hasta),
    repo.getParametrosMeseros(desde, hasta),
    repo.getParametrosCocina(desde, hasta),
    repo.getTiempoEntrega(desde, hasta),
  ]);

  const efectivo = Number(ingresosPorMetodo.efectivo);
  const banco = Number(ingresosPorMetodo.banco);
  const ingresos = efectivo + banco;
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
      efectivo,
      banco,
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
    administrativo: {
      cuentas: Number(administrativo.cuentas),
      total: Number(administrativo.total),
    },
  };
}

export async function obtenerAnalyticsConSentido(desde: string, hasta: string): Promise<AnalyticsConSentido> {
  const [ingresos, ingresosPorMetodo, ventasPorCategoria, productosTop] = await Promise.all([
    repo.getIngresosConSentido(desde, hasta),
    repo.getIngresosPorMetodoPagoConSentido(desde, hasta),
    repo.getVentasPorCategoriaConSentido(desde, hasta),
    repo.getProductosTopConSentido(desde, hasta, 5),
  ]);
  // Con Sentido no vincula sus ventas a un cliente (son ventas de mostrador,
  // ver con_sentido_venta_items) — no hay de dónde sacar "clientes frecuentes"
  // reales todavía, así que queda vacío en vez de inventar datos.
  const clientes: { cliente_nombre: string; compras: string; total: string }[] = [];

  // "ingresos" sale de movimientos_caja (efectivo+banco), no de sumar
  // con_sentido_ventas.monto: así incluye también los ingresos que alguien
  // registró a mano desde Caja General con área "Con Sentido" (mismo
  // criterio que ganancias.ingresos en Migao) — ventasCount/categoría/top sí
  // se quedan acotados a ventas reales con ítems, un ingreso manual no los tiene.
  const efectivo = Number(ingresosPorMetodo.efectivo || 0);
  const banco = Number(ingresosPorMetodo.banco || 0);

  return {
    ingresos: efectivo + banco,
    efectivo,
    banco,
    ventasCount: Number(ingresos.cantidad || 0),
    ventasPorCategoria: ventasPorCategoria.map((v) => ({
      categoria: v.categoria,
      cantidad: Number(v.cantidad),
      total: Number(v.total),
    })),
    productosTopVendidos: productosTop.map((p) => ({
      productoNombre: p.producto_nombre,
      cantidadVendida: Number(p.cantidad),
      ingresoTotal: Number(p.total),
    })),
    clientesFrecuentes: clientes.map((c) => ({
      clienteNombre: c.cliente_nombre,
      compras: Number(c.compras),
      totalGastado: Number(c.total),
    })),
  };
}

export async function obtenerAnalyticsInsumos(desde: string, hasta: string): Promise<AnalyticsInsumos> {
  const [ingresos, productosVendidos, costos] = await Promise.all([
    repo.getIngresosModulo(2, desde, hasta),
    repo.getProductosTopVendidos(2, desde, hasta, 10),
    repo.getCostosModulo(2, desde, hasta),
  ]);

  const totalCostos = Number(costos.total_costos || 0);
  const totalIngresos = Number(ingresos.total || 0);
  const ganancia = totalIngresos - totalCostos;

  return {
    ingresos: totalIngresos,
    costos: totalCostos,
    ganancia,
    margenNeto: totalIngresos > 0 ? Math.round((ganancia / totalIngresos) * 100) : 0,
    ventasCount: Number(ingresos.cantidad || 0),
    productosVendidos: productosVendidos.map((p) => ({
      productoNombre: p.producto_nombre,
      cantidadVendida: Number(p.cantidad),
      costo: Number(p.costo || 0),
      precio: Number(p.precio),
      margen: Number(p.precio) - Number(p.costo || 0),
    })),
  };
}

export async function obtenerAnalyticsPedidos(desde: string, hasta: string): Promise<AnalyticsPedidos> {
  const [pedidos, porEstado, ganancias] = await Promise.all([
    repo.getPedidosResumen(desde, hasta),
    repo.getPedidosPorEstado(desde, hasta),
    repo.getGananciasPedidos(desde, hasta),
  ]);

  return {
    pedidosTotal: Number(pedidos.total),
    ingresoTotal: Number(pedidos.ingreso_total || 0),
    costoTotal: Number(pedidos.costo_total || 0),
    gananciaTotal: Number(ganancias.ganancia_total || 0),
    margenPromedio: Number(ganancias.margen_promedio || 0),
    porEstado: porEstado.map((p) => ({
      estado: p.estado,
      cantidad: Number(p.cantidad),
      ingresoEstimado: Number(p.ingreso_estimado || 0),
    })),
    proximas_entregas: pedidos.proximas_entregas || [],
  };
}
