import { apiFetch } from "../../shared/api/client";

export type FuenteVale = "turno" | "acumulado" | "dueno";
export type TipoVale = "pago" | "deuda";
export type EstadoVale = "activo" | "resuelto" | "anulado";

export interface Vale {
  id: string;
  numero: string;
  tipo: TipoVale;
  pagado_a: string;
  destinatario_usuario_id: string | null;
  destinatario_usuario_nombre: string | null;
  destinatario_documento: string | null;
  concepto: string;
  monto_efectivo: string;
  monto_banco: string;
  monto_adeudado: string | null;
  fuente: FuenteVale | null;
  dueno_id: string | null;
  dueno_nombre: string | null;
  repuesto_en: string | null;
  fuente_reposicion: FuenteVale | null;
  cobrado_en: string | null;
  monto_cobrado_efectivo: string;
  monto_cobrado_banco: string;
  anulado_en: string | null;
  creado_por_nombre: string | null;
  created_at: string;
}

// Mismo shape que descomponerPago espera del lado del backend — nunca se
// manda referenciaBanco (esa regla es solo para pagos recibidos, nunca para
// un vale/préstamo que siempre es dinero que sale).
export type PagoValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

// Cobrar SÍ necesita referenciaBanco cuando hay banco de por medio — es un
// ingreso (dinero que entra), al revés que crear un vale.
export type CobrarValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number; referenciaBanco?: string }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number; referenciaBanco?: string };

type CamposComunesVale = {
  pagadoA: string;
  destinatarioUsuarioId?: string;
  destinatarioDocumento?: string;
  concepto: string;
};

export type CrearValeInput =
  | (CamposComunesVale & { tipo?: TipoVale; fuente: FuenteVale; duenoId?: string } & PagoValeInput)
  | (CamposComunesVale & { tipo: "deuda"; montoAdeudado: number });

export interface ReponerValeInput {
  fuenteReposicion: "turno" | "acumulado";
}

export const valesApi = {
  listar: (filtros?: { tipo?: TipoVale; fuente?: FuenteVale; estado?: EstadoVale }) => {
    const params = new URLSearchParams();
    if (filtros?.tipo) params.set("tipo", filtros.tipo);
    if (filtros?.fuente) params.set("fuente", filtros.fuente);
    if (filtros?.estado) params.set("estado", filtros.estado);
    const qs = params.toString();
    return apiFetch<Vale[]>(`/vales${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<Vale>(`/vales/${id}`),
  crear: (input: CrearValeInput) => apiFetch<Vale>("/vales", { method: "POST", body: input }),
  marcarRepuesto: (id: string, input: ReponerValeInput) =>
    apiFetch<Vale>(`/vales/${id}/reponer`, { method: "POST", body: input }),
  cobrar: (id: string, input: CobrarValeInput) =>
    apiFetch<Vale>(`/vales/${id}/cobrar`, { method: "POST", body: input }),
  anular: (id: string) => apiFetch<Vale>(`/vales/${id}/anular`, { method: "POST" }),
};
