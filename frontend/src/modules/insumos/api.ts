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
};
