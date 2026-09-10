import { Request, Response } from "express";
import { ok } from "../../shared/utils/response";
import { actualizarParametrosConcretoSchema, calcularConcretoSchema } from "./concreto.schema";
import * as service from "./concreto.service";

export async function obtenerParametrosController(_req: Request, res: Response) {
  return ok(res, await service.obtenerParametros());
}

export async function actualizarParametrosController(req: Request, res: Response) {
  const data = actualizarParametrosConcretoSchema.parse(req.body);
  return ok(res, await service.actualizarParametros(data));
}

// No persiste nada — la calculadora interactiva pega acá en cada cambio del peso.
export async function calcularController(req: Request, res: Response) {
  const data = calcularConcretoSchema.parse(req.body);
  return ok(res, await service.calcular(data));
}
