import { Errors } from "../../shared/utils/app-error";
import * as repo from "./recetario.repository";
import { CrearEmplatadoInput, CrearRecetaInput, EditarEmplatadoInput, EditarRecetaInput } from "./recetario.schema";

export async function listarCategorias() {
  return repo.listarCategorias();
}

export async function crearCategoria(nombre: string) {
  return repo.crearCategoria(nombre);
}

export async function eliminarCategoria(id: number) {
  const enUso = await repo.contarRecetasPorCategoria(id);
  if (enUso > 0) {
    throw Errors.conflict(
      `No se puede eliminar: ${enUso} receta${enUso === 1 ? "" : "s"} ${enUso === 1 ? "usa" : "usan"} esta categoría. Cámbiale la categoría a esa${enUso === 1 ? "" : "s"} receta${enUso === 1 ? "" : "s"} primero.`,
    );
  }
  const eliminada = await repo.eliminarCategoria(id);
  if (!eliminada) throw Errors.notFound("Categoría no encontrada");
}

export async function listarRecetas() {
  const recetas = await repo.listarRecetas();
  // El tipo Receta del frontend siempre trae `emplatados` — cualquier
  // endpoint que devuelva una Receta debe cumplirlo, no solo obtenerReceta.
  return Promise.all(recetas.map(async (r) => ({ ...r, emplatados: await repo.listarEmplatadosDeReceta(r.id) })));
}

export async function obtenerReceta(id: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  const emplatados = await repo.listarEmplatadosDeReceta(id);
  return { ...receta, emplatados };
}

export async function crearReceta(input: CrearRecetaInput, usuarioId: string) {
  const id = await repo.crearReceta({
    titulo: input.titulo,
    instrucciones: input.instrucciones,
    categoriaId: input.categoriaId ?? null,
    videoUrl: input.videoUrl ?? null,
    creadoPorId: usuarioId,
  });
  return obtenerReceta(id);
}

export async function editarReceta(id: string, input: EditarRecetaInput) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.editarReceta(id, input);
  return obtenerReceta(id);
}

export async function eliminarReceta(id: string) {
  const eliminada = await repo.eliminarReceta(id);
  if (!eliminada) throw Errors.notFound("Receta no encontrada");
}

export async function actualizarImagenPrincipal(id: string, imagenUrl: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.actualizarImagenPrincipal(id, imagenUrl);
  return obtenerReceta(id);
}

export async function listarTodosEmplatados() {
  return repo.listarTodosEmplatados();
}

export async function crearEmplatado(recetaId: string, input: CrearEmplatadoInput) {
  const receta = await repo.getRecetaById(recetaId);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  const id = await repo.crearEmplatado({ recetaId, nombre: input.nombre, guia: input.guia ?? null });
  return repo.getEmplatadoById(id);
}

export async function editarEmplatado(id: string, input: EditarEmplatadoInput) {
  const emplatado = await repo.getEmplatadoById(id);
  if (!emplatado) throw Errors.notFound("Presentación no encontrada");
  await repo.editarEmplatado(id, input);
  return repo.getEmplatadoById(id);
}

export async function eliminarEmplatado(id: string) {
  const eliminado = await repo.eliminarEmplatado(id);
  if (!eliminado) throw Errors.notFound("Presentación no encontrada");
}

export async function actualizarImagenEmplatado(id: string, imagenUrl: string) {
  const emplatado = await repo.getEmplatadoById(id);
  if (!emplatado) throw Errors.notFound("Presentación no encontrada");
  await repo.actualizarImagenEmplatado(id, imagenUrl);
  return repo.getEmplatadoById(id);
}
