export interface AnalyticsConSentido {
  ingresos: number;
  efectivo: number;
  banco: number;
  ventasCount: number;
  ventasPorCategoria: {
    categoria: string;
    cantidad: number;
    total: number;
  }[];
  productosTopVendidos: {
    productoNombre: string;
    cantidadVendida: number;
    ingresoTotal: number;
  }[];
  clientesFrecuentes: {
    clienteNombre: string;
    compras: number;
    totalGastado: number;
  }[];
}

export interface AnalyticsInsumos {
  ingresos: number;
  costos: number;
  ganancia: number;
  margenNeto: number;
  ventasCount: number;
  productosVendidos: {
    productoNombre: string;
    cantidadVendida: number;
    costo: number;
    precio: number;
    margen: number;
  }[];
}

// Talleres es deliberadamente más simple que Insumos: sin COGS/margen, sin
// top de productos, sin movimientos de inventario — esos son conceptos
// propios de Insumos que no aplican acá (no hay un catálogo de productos
// "Talleres" con costo, ver decisión de diseño). Solo ingresos/egresos/saldo.
export interface AnalyticsTalleres {
  ingresos: number;
  egresos: number;
  saldoNeto: number;
}

export interface AnalyticsPedidos {
  pedidosTotal: number;
  ingresoTotal: number;
  costoTotal: number;
  gananciaTotal: number;
  margenPromedio: number;
  porEstado: {
    estado: string;
    cantidad: number;
    ingresoEstimado: number;
  }[];
  proximas_entregas: any[];
}
