import { apiFetch } from "../../shared/api/client";

export interface AnalyticsMigao {
  pedidos: {
    cerradas: number;
    canceladas: number;
    comensales: number;
    clientesUnicos: number;
  };
  ganancias: {
    ingresos: number;
    costos: number;
    ganancia: number;
    itemsVendidos: number;
  };
  meseros: {
    meseroId: string;
    meseroNombre: string;
    ordenes: number;
    totalVendido: number;
    tiempoPromedioMin: number | null;
    canceladas: number;
  }[];
  cocina: {
    itemsPreparados: number;
    tiempoPromedioMin: number | null;
  };
  entrega: {
    itemsEntregados: number;
    tiempoPromedioMin: number | null;
  };
}

export const analyticsApi = {
  obtenerMigao: (desde: string, hasta: string) =>
    apiFetch<AnalyticsMigao>(`/analytics/migao?desde=${desde}&hasta=${hasta}`),
};
