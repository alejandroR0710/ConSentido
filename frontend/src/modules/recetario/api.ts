import { apiFetch, apiUpload } from "../../shared/api/client";

export interface RecetarioCategoria {
  id: number;
  nombre: string;
}

export interface Receta {
  id: string;
  titulo: string;
  instrucciones: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  video_url: string | null;
  imagen_principal_url: string | null;
  imagen_emplatado_url: string | null;
  descripcion_emplatado: string | null;
  creado_por_id: string;
  creado_por_nombre: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrearRecetaInput {
  titulo: string;
  instrucciones: string;
  categoriaId?: number;
  videoUrl?: string;
  descripcionEmplatado?: string;
}

export interface EditarRecetaInput {
  titulo?: string;
  instrucciones?: string;
  categoriaId?: number | null;
  videoUrl?: string | null;
  descripcionEmplatado?: string | null;
}

export const recetarioApi = {
  listarCategorias: () => apiFetch<RecetarioCategoria[]>("/recetario/categorias"),
  crearCategoria: (nombre: string) =>
    apiFetch<RecetarioCategoria>("/recetario/categorias", { method: "POST", body: { nombre } }),
  listar: () => apiFetch<Receta[]>("/recetario/recetas"),
  obtener: (id: string) => apiFetch<Receta>(`/recetario/recetas/${id}`),
  crear: (input: CrearRecetaInput) => apiFetch<Receta>("/recetario/recetas", { method: "POST", body: input }),
  editar: (id: string, input: EditarRecetaInput) =>
    apiFetch<Receta>(`/recetario/recetas/${id}`, { method: "PATCH", body: input }),
  eliminar: (id: string) => apiFetch<{ eliminada: boolean }>(`/recetario/recetas/${id}`, { method: "DELETE" }),
  subirImagenPrincipal: (id: string, file: File) =>
    apiUpload<Receta>(`/recetario/recetas/${id}/imagen-principal`, file),
  subirImagenEmplatado: (id: string, file: File) =>
    apiUpload<Receta>(`/recetario/recetas/${id}/imagen-emplatado`, file),
};
