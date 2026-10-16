import { Request, Response } from "express";
import { Errors } from "../../shared/utils/app-error";
import { ok, created } from "../../shared/utils/response";
import { rutaPublicaImagen } from "../../shared/middlewares/upload.middleware";
import * as service from "./recetario.service";
import { crearCategoriaSchema, crearRecetaSchema, editarRecetaSchema } from "./recetario.schema";

export async function listarCategoriasController(req: Request, res: Response) {
  return ok(res, await service.listarCategorias());
}

export async function crearCategoriaController(req: Request, res: Response) {
  const data = crearCategoriaSchema.parse(req.body);
  return created(res, await service.crearCategoria(data.nombre));
}

export async function listarRecetasController(req: Request, res: Response) {
  return ok(res, await service.listarRecetas());
}

export async function obtenerRecetaController(req: Request, res: Response) {
  return ok(res, await service.obtenerReceta(req.params.id));
}

export async function crearRecetaController(req: Request, res: Response) {
  const data = crearRecetaSchema.parse(req.body);
  return created(res, await service.crearReceta(data, req.auth!.usuarioId));
}

export async function editarRecetaController(req: Request, res: Response) {
  const data = editarRecetaSchema.parse(req.body);
  return ok(res, await service.editarReceta(req.params.id, data));
}

export async function eliminarRecetaController(req: Request, res: Response) {
  await service.eliminarReceta(req.params.id);
  return ok(res, { eliminada: true });
}

export async function subirImagenPrincipalController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("recetario", req.file.filename);
  return ok(res, await service.actualizarImagenPrincipal(req.params.id, imagenUrl));
}

export async function subirImagenEmplatadoController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("recetario", req.file.filename);
  return ok(res, await service.actualizarImagenEmplatado(req.params.id, imagenUrl));
}
