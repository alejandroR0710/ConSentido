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
    // Desglose del mismo `ingresos` por método de pago (viene de los
    // movimientos reales de Caja General, ya con descuento aplicado).
    efectivo: number;
    banco: number;
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
  // Cuentas cerradas con pago "administrativo" — no cuentan en ganancias/
  // ingresos de arriba, se muestran aparte (ver Historial Administrativo).
  administrativo: {
    cuentas: number;
    total: number;
  };
}

export const analyticsApi = {
  obtenerMigao: (desde: string, hasta: string) =>
    apiFetch<AnalyticsMigao>(`/analytics/migao?desde=${desde}&hasta=${hasta}`),
};
