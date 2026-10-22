import { Errors } from "../../shared/utils/app-error";
import * as repo from "./recetario.repository";
import { CrearRecetaInput, EditarRecetaInput } from "./recetario.schema";

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
  return repo.listarRecetas();
}

export async function obtenerReceta(id: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  return receta;
}

export async function crearReceta(input: CrearRecetaInput, usuarioId: string) {
  const id = await repo.crearReceta({
    titulo: input.titulo,
    instrucciones: input.instrucciones,
    categoriaId: input.categoriaId ?? null,
    videoUrl: input.videoUrl ?? null,
    descripcionEmplatado: input.descripcionEmplatado ?? null,
    creadoPorId: usuarioId,
  });
  return repo.getRecetaById(id);
}

export async function editarReceta(id: string, input: EditarRecetaInput) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.editarReceta(id, input);
  return repo.getRecetaById(id);
}

export async function eliminarReceta(id: string) {
  const eliminada = await repo.eliminarReceta(id);
  if (!eliminada) throw Errors.notFound("Receta no encontrada");
}

export async function actualizarImagenPrincipal(id: string, imagenUrl: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.actualizarImagenPrincipal(id, imagenUrl);
  return repo.getRecetaById(id);
}

export async function actualizarImagenEmplatado(id: string, imagenUrl: string) {
  const receta = await repo.getRecetaById(id);
  if (!receta) throw Errors.notFound("Receta no encontrada");
  await repo.actualizarImagenEmplatado(id, imagenUrl);
  return repo.getRecetaById(id);
}
