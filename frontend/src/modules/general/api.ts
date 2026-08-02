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

export interface AnalyticsGeneral {
  resumenGeneral: {
    ingresos_totales: number;
    egresos_totales: number;
    saldo_neto: number;
  };
  porModulo: {
    modulo_id: number;
    modulo_nombre: string;
    ingresos: number;
    egresos: number;
    saldo_neto: number;
    efectivo: number;
    banco: number;
  }[];
}

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

export const analyticsApi = {
  obtenerGeneral: (desde: string, hasta: string) =>
    apiFetch<AnalyticsGeneral>(`/analytics/general?desde=${desde}&hasta=${hasta}`),
  obtenerMigao: (desde: string, hasta: string) =>
    apiFetch<AnalyticsMigao>(`/analytics/migao?desde=${desde}&hasta=${hasta}`),
  obtenerConSentido: (desde: string, hasta: string) =>
    apiFetch<AnalyticsConSentido>(`/analytics/con-sentido?desde=${desde}&hasta=${hasta}`),
  obtenerInsumos: (desde: string, hasta: string) =>
    apiFetch<AnalyticsInsumos>(`/analytics/insumos?desde=${desde}&hasta=${hasta}`),
  obtenerPedidos: (desde: string, hasta: string) =>
    apiFetch<AnalyticsPedidos>(`/analytics/pedidos?desde=${desde}&hasta=${hasta}`),
};

export interface Usuario {
  id: string;
  nombre: string;
  // Cada usuario tiene guardado uno u otro, nunca ambos (ver el CHECK en la
  // tabla usuarios) — el módulo de Usuarios elige cuál usar al crear/editar.
  email: string | null;
  numero_documento: string | null;
  rol_id: number;
  rol_nombre: string;
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
}

export interface Rol {
  id: number;
  nombre: string;
}

export type TipoIdentificador = "email" | "documento";

export const usuariosApi = {
  listar: () => apiFetch<Usuario[]>("/usuarios"),
  listarRoles: () => apiFetch<Rol[]>("/usuarios/roles"),
  crear: (input: {
    nombre: string;
    password: string;
    rolId: number;
    tipoIdentificador: TipoIdentificador;
    identificador: string;
  }) => apiFetch<Usuario>("/usuarios", { method: "POST", body: input }),
  editar: (
    id: string,
    input: {
      nombre?: string;
      password?: string;
      rolId?: number;
      activo?: boolean;
      tipoIdentificador?: TipoIdentificador;
      identificador?: string;
    },
  ) => apiFetch<Usuario>(`/usuarios/${id}`, { method: "PATCH", body: input }),
  eliminar: (id: string) => apiFetch<{ eliminado: boolean }>(`/usuarios/${id}`, { method: "DELETE" }),
};
