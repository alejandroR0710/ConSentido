export interface AnalyticsConSentido {
  ingresos: number;
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
