import { Request, Response } from "express";
import { created, ok } from "../../shared/utils/response";
import * as amasijosService from "./amasijos.service";
import {
  actualizarRecetaLineaSchema,
  crearRecetaLineaSchema,
  prepararBaseSchema,
} from "./amasijos.schema";

export async function obtenerAmasijosController(_req: Request, res: Response) {
  return ok(res, await amasijosService.obtenerAmasijos());
}

export async function obtenerBasesController(_req: Request, res: Response) {
  return ok(res, await amasijosService.obtenerBases());
}

export async function obtenerRecomendacionesController(_req: Request, res: Response) {
  return ok(res, await amasijosService.obtenerRecomendaciones());
}

export async function prepararBaseController(req: Request, res: Response) {
  const data = prepararBaseSchema.parse(req.body);
  const resultado = await amasijosService.prepararBase(data.baseProductoId, data.cantidad, req.auth!.usuarioId);
  return created(res, resultado);
}

export async function obtenerRecetasController(_req: Request, res: Response) {
  return ok(res, await amasijosService.obtenerRecetas());
}

export async function crearRecetaLineaController(req: Request, res: Response) {
  const data = crearRecetaLineaSchema.parse(req.body);
  const resultado = await amasijosService.crearRecetaLinea(data.baseProductoId, data.amasijoProductoId, data.cantidadAmasijo);
  return created(res, resultado);
}

export async function actualizarRecetaLineaController(req: Request, res: Response) {
  const data = actualizarRecetaLineaSchema.parse(req.body);
  const resultado = await amasijosService.actualizarRecetaLinea(req.params.id, data.cantidadAmasijo);
  return ok(res, resultado);
}

export async function eliminarRecetaLineaController(req: Request, res: Response) {
  await amasijosService.eliminarRecetaLinea(req.params.id);
  return ok(res, { eliminada: true });
}
