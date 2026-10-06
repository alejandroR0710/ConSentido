import { apiFetch } from "../../shared/api/client";

export type FuenteVale = "turno" | "acumulado" | "dueno";

export interface Vale {
  id: string;
  numero: string;
  pagado_a: string;
  destinatario_usuario_id: string | null;
  destinatario_usuario_nombre: string | null;
  destinatario_documento: string | null;
  concepto: string;
  monto_efectivo: string;
  monto_banco: string;
  fuente: FuenteVale;
  dueno_id: string | null;
  dueno_nombre: string | null;
  repuesto_en: string | null;
  fuente_reposicion: FuenteVale | null;
  anulado_en: string | null;
  creado_por_nombre: string | null;
  created_at: string;
}

// Mismo shape que descomponerPago espera del lado del backend — nunca se
// manda referenciaBanco (esa regla es solo para pagos recibidos).
export type PagoValeInput =
  | { metodoPago: "efectivo" | "banco"; monto: number }
  | { metodoPago: "mixto"; montoEfectivo: number; montoBanco: number };

export type CrearValeInput = {
  pagadoA: string;
  destinatarioUsuarioId?: string;
  destinatarioDocumento?: string;
  concepto: string;
  fuente: FuenteVale;
  duenoId?: string;
} & PagoValeInput;

export interface ReponerValeInput {
  fuenteReposicion: "turno" | "acumulado";
}

export const valesApi = {
  listar: (filtros?: { fuente?: FuenteVale; estado?: "activo" | "repuesto" | "anulado" }) => {
    const params = new URLSearchParams();
    if (filtros?.fuente) params.set("fuente", filtros.fuente);
    if (filtros?.estado) params.set("estado", filtros.estado);
    const qs = params.toString();
    return apiFetch<Vale[]>(`/vales${qs ? `?${qs}` : ""}`);
  },
  obtener: (id: string) => apiFetch<Vale>(`/vales/${id}`),
  crear: (input: CrearValeInput) => apiFetch<Vale>("/vales", { method: "POST", body: input }),
  marcarRepuesto: (id: string, input: ReponerValeInput) =>
    apiFetch<Vale>(`/vales/${id}/reponer`, { method: "POST", body: input }),
  anular: (id: string) => apiFetch<Vale>(`/vales/${id}/anular`, { method: "POST" }),
};
