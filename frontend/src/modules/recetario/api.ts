import { apiFetch, apiUpload } from "../../shared/api/client";

export interface RecetarioCategoria {
  id: number;
  nombre: string;
}

export interface Emplatado {
  id: string;
  receta_id: string;
  nombre: string;
  imagen_url: string | null;
  guia: string | null;
  created_at: string;
}

// Lista plana de todas las presentaciones de todas las recetas, con el
// título de su receta — para el selector que usa Migao al amarrar un
// producto a una (ver EditarProductoModal/NuevoProductoModal).
export interface EmplatadoConReceta {
  id: string;
  receta_id: string;
  nombre: string;
  receta_titulo: string;
}

export interface Receta {
  id: string;
  titulo: string;
  instrucciones: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  video_url: string | null;
  imagen_principal_url: string | null;
  emplatados: Emplatado[];
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
}

export interface EditarRecetaInput {
  titulo?: string;
  instrucciones?: string;
  categoriaId?: number | null;
  videoUrl?: string | null;
}

export interface CrearEmplatadoInput {
  nombre: string;
  guia?: string;
}

export interface EditarEmplatadoInput {
  nombre?: string;
  guia?: string | null;
}

export const recetarioApi = {
  listarCategorias: () => apiFetch<RecetarioCategoria[]>("/recetario/categorias"),
  crearCategoria: (nombre: string) =>
    apiFetch<RecetarioCategoria>("/recetario/categorias", { method: "POST", body: { nombre } }),
  eliminarCategoria: (id: number) =>
    apiFetch<{ eliminada: boolean }>(`/recetario/categorias/${id}`, { method: "DELETE" }),
  listar: () => apiFetch<Receta[]>("/recetario/recetas"),
  obtener: (id: string) => apiFetch<Receta>(`/recetario/recetas/${id}`),
  crear: (input: CrearRecetaInput) => apiFetch<Receta>("/recetario/recetas", { method: "POST", body: input }),
  editar: (id: string, input: EditarRecetaInput) =>
    apiFetch<Receta>(`/recetario/recetas/${id}`, { method: "PATCH", body: input }),
  eliminar: (id: string) => apiFetch<{ eliminada: boolean }>(`/recetario/recetas/${id}`, { method: "DELETE" }),
  subirImagenPrincipal: (id: string, file: File) =>
    apiUpload<Receta>(`/recetario/recetas/${id}/imagen-principal`, file),

  listarTodosEmplatados: () => apiFetch<EmplatadoConReceta[]>("/recetario/emplatados"),
  crearEmplatado: (recetaId: string, input: CrearEmplatadoInput) =>
    apiFetch<Emplatado>(`/recetario/recetas/${recetaId}/emplatados`, { method: "POST", body: input }),
  editarEmplatado: (id: string, input: EditarEmplatadoInput) =>
    apiFetch<Emplatado>(`/recetario/emplatados/${id}`, { method: "PATCH", body: input }),
  eliminarEmplatado: (id: string) => apiFetch<{ eliminada: boolean }>(`/recetario/emplatados/${id}`, { method: "DELETE" }),
  subirImagenEmplatado: (id: string, file: File) => apiUpload<Emplatado>(`/recetario/emplatados/${id}/imagen`, file),
};
