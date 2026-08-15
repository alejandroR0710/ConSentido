import { apiFetch, apiUpload } from "../../shared/api/client";

export interface Insumo {
  id: string;
  nombre: string;
  categoriaId: number | null;
  unidadMedida: string;
  stockMinimo: string;
  costoUnitario: string;
  proveedorPrincipalId: string | null;
  imagenUrl: string | null;
  descripcion: string | null;
  activo: boolean;
}

export interface Almacen {
  id: number;
  nombre: string;
  modulo_id: number | null;
  ubicacion: string | null;
}

export interface CrearInsumoInput {
  nombre: string;
  unidadMedida: string;
  stockMinimo: number;
  costoUnitario: number;
  descripcion?: string;
}

export interface EditarInsumoInput {
  nombre?: string;
  unidadMedida?: string;
  stockMinimo?: number;
  costoUnitario?: number;
  descripcion?: string;
  activo?: boolean;
}

export interface RegistrarMovimientoInput {
  insumoId: string;
  almacenId: number;
  tipo: "entrada" | "salida" | "transferencia" | "ajuste";
  cantidad: number;
  motivo?: string;
  almacenDestinoId?: number;
}

export interface MovimientoInsumo {
  id: number;
  tipo: "entrada" | "salida" | "transferencia" | "ajuste";
  cantidad: string;
  costo_unitario: string | null;
  motivo: string | null;
  created_at: string;
  insumo_nombre: string;
  unidad_medida: string;
  almacen_nombre: string;
  almacen_destino_nombre: string | null;
  proveedor_nombre: string | null;
  usuario_nombre: string | null;
}

export const insumosApi = {
  listar: () => apiFetch<Insumo[]>("/insumos"),
  listarAdmin: () => apiFetch<Insumo[]>("/insumos/admin"),
  crear: (data: CrearInsumoInput) => apiFetch<Insumo>("/insumos", { method: "POST", body: data }),
  editar: (id: string, data: EditarInsumoInput) => apiFetch<Insumo>(`/insumos/${id}`, { method: "PATCH", body: data }),
  subirImagen: (id: string, file: File) => apiUpload<Insumo>(`/insumos/${id}/imagen`, file),
  listarAlmacenes: () => apiFetch<Almacen[]>("/insumos/almacenes"),
  registrarMovimiento: (data: RegistrarMovimientoInput) =>
    apiFetch<{ insumoId: string; almacenId: number; nuevoStock: number }>("/insumos/movimientos", {
      method: "POST",
      body: data,
    }),
  listarMovimientos: (desde: string, hasta: string) =>
    apiFetch<MovimientoInsumo[]>(`/insumos/movimientos?desde=${desde}&hasta=${hasta}`),
};
