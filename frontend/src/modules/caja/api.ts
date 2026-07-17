import { apiFetch } from "../../shared/api/client";

export type MetodoPago = "efectivo" | "banco";
export type ModuloOrigenSlug = "insumos" | "talleres" | "con_sentido" | "migao" | "pedidos" | "general";

// "mixto" no es un método real (ver backend shared/utils/pago-mixto.ts): el
// backend lo descompone en 1-2 movimientos ya con método puro.
export type PagoInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

// Igual que PagoInput pero sin `monto`: al corregir un movimiento ya existente
// el total no cambia, solo cómo se reparte entre los dos métodos.
export type EditarPagoInput =
  | { metodoPago: "efectivo" | "banco" }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

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

export interface IngresoPorArea {
  slug: string;
  nombre: string;
  total: number;
}

export interface ResumenTurno {
  turno: TurnoCaja;
  movimientos: MovimientoCaja[];
  saldos: { efectivo: number; banco: number; general: number };
  ingresosPorArea: IngresoPorArea[];
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
  egresosBorrados: number;
}

export const cajaApi = {
  obtenerTurnoActual: () => apiFetch<TurnoCaja | null>("/caja/turno-actual"),
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
  registrarIngreso: (input: { moduloOrigenSlug: ModuloOrigenSlug; motivo?: string } & PagoInput) =>
    apiFetch<MovimientoCaja[]>("/caja/ingresos", { method: "POST", body: input }),
  registrarEgreso: (input: { categoriaGastoId: number; motivo: string } & PagoInput) =>
    apiFetch<MovimientoCaja[]>("/caja/egresos", { method: "POST", body: input }),
  editarMetodoPagoMovimiento: (movimientoId: number | string, input: EditarPagoInput) =>
    apiFetch<MovimientoCaja[]>(`/caja/movimientos/${movimientoId}/metodo-pago`, {
      method: "PATCH",
      body: input,
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
  listarTurnosPorFecha: (fecha: string) => apiFetch<TurnoCaja[]>(`/caja/turnos-por-fecha?fecha=${fecha}`),
  listarMovimientosPorFecha: (fecha: string) =>
    apiFetch<MovimientoCaja[]>(`/caja/movimientos-por-fecha?fecha=${fecha}`),
  // Borrados permanentes, exclusivos de Super Root: a diferencia de resetear(),
  // estos sí borran datos y no se pueden deshacer.
  borrarHistorialDia: (fecha: string) =>
    apiFetch<{ movimientosBorrados: number }>("/caja/historial/borrar-dia", {
      method: "POST",
      body: { fecha, confirmacion: "BORRAR HISTORIAL DEL DIA" },
    }),
  borrarTurno: (turnoId: string) =>
    apiFetch<{ movimientosBorrados: number }>(`/caja/turnos/${turnoId}`, {
      method: "DELETE",
      body: { confirmacion: "BORRAR TURNO" },
    }),
};
