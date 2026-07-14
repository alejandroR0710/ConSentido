import { apiFetch } from "../../shared/api/client";

export type MetodoPago = "efectivo" | "banco";
export type ModuloOrigenSlug = "insumos" | "talleres" | "con_sentido" | "migao" | "pedidos" | "general";

export interface TurnoCaja {
  id: string;
  cajeroId: string;
  montoInicialEfectivo: string;
  montoInicialBanco: string;
  montoFinalDeclaradoEfectivo: string | null;
  montoFinalCalculadoEfectivo: string | null;
  diferenciaEfectivo: string | null;
  montoFinalCalculadoBanco: string | null;
  estado: "abierto" | "cerrado";
  abiertoEn: string;
  cerradoEn: string | null;
}

export interface MovimientoCaja {
  id: number;
  turno_id: string;
  tipo: "ingreso" | "egreso";
  modulo_origen_id: number | null;
  categoria_gasto_id: number | null;
  referencia_entidad: string | null;
  referencia_id: string | null;
  monto: string;
  metodo_pago: MetodoPago;
  motivo: string | null;
  usuario_id: string | null;
  created_at: string;
  modulo_origen_slug: string | null;
  categoria_gasto_nombre: string | null;
}

export interface ResumenTurno {
  turno: TurnoCaja;
  movimientos: MovimientoCaja[];
  saldos: { efectivo: number; banco: number; general: number };
  ingresosEfectivo: number;
  egresosEfectivo: number;
  ingresosBanco: number;
  egresosBanco: number;
}

export interface CategoriaGasto {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface DiaHistorialCaja {
  fecha: string;
  ingresos: number;
  egresos: number;
  neto: number;
  movimientos: number;
}

export interface ResetearCajaResultado {
  turnoCerrado: TurnoCaja | null;
  marcador: TurnoCaja;
}

export interface ProyeccionApertura {
  hayCierreAnterior: boolean;
  montoInicialEfectivo: number;
  montoInicialBanco: number;
}

export const cajaApi = {
  obtenerTurnoActual: () => apiFetch<TurnoCaja | null>("/caja/turno-actual"),
  obtenerProyeccionApertura: () => apiFetch<ProyeccionApertura>("/caja/proxima-apertura"),
  abrirTurno: (montoInicialEfectivo?: number, montoInicialBanco?: number) =>
    apiFetch<TurnoCaja>("/caja/turnos", {
      method: "POST",
      body: { montoInicialEfectivo, montoInicialBanco },
    }),
  cerrarTurno: (turnoId: string, montoFinalDeclaradoEfectivo: number) =>
    apiFetch<TurnoCaja>(`/caja/turnos/${turnoId}/cerrar`, {
      method: "PATCH",
      body: { montoFinalDeclaradoEfectivo },
    }),
  obtenerResumenTurno: (turnoId: string) => apiFetch<ResumenTurno>(`/caja/turnos/${turnoId}/resumen`),
  registrarIngreso: (input: {
    moduloOrigenSlug: ModuloOrigenSlug;
    monto: number;
    metodoPago: MetodoPago;
    motivo?: string;
  }) => apiFetch<MovimientoCaja>("/caja/ingresos", { method: "POST", body: input }),
  registrarEgreso: (input: { categoriaGastoId: number; monto: number; metodoPago: MetodoPago; motivo: string }) =>
    apiFetch<MovimientoCaja>("/caja/egresos", { method: "POST", body: input }),
  editarMetodoPagoMovimiento: (movimientoId: number | string, metodoPago: MetodoPago) =>
    apiFetch<MovimientoCaja>(`/caja/movimientos/${movimientoId}/metodo-pago`, {
      method: "PATCH",
      body: { metodoPago },
    }),
  listarCategoriasGasto: () => apiFetch<CategoriaGasto[]>("/caja/categorias-gasto"),
  crearCategoriaGasto: (nombre: string) =>
    apiFetch<CategoriaGasto>("/caja/categorias-gasto", { method: "POST", body: { nombre } }),
  obtenerHistorialAnual: (anio: number) => apiFetch<DiaHistorialCaja[]>(`/caja/historial?anio=${anio}`),
  resetear: () =>
    apiFetch<ResetearCajaResultado>("/caja/reset", {
      method: "POST",
      body: { confirmacion: "REINICIAR CAJA" },
    }),
};
