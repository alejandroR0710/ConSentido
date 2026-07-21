import { Request, Response } from "express";
import { ok } from "../../../shared/utils/response";
import { desuscribirSchema, suscribirSchema } from "./notificaciones.schema";
import * as service from "./notificaciones.service";

export async function obtenerClavePublicaController(_req: Request, res: Response) {
  return ok(res, { clavePublica: service.obtenerClavePublica() });
}

export async function suscribirController(req: Request, res: Response) {
  const data = suscribirSchema.parse(req.body);
  await service.suscribir(req.auth!.usuarioId, data, req.headers["user-agent"]);
  return ok(res, { suscrito: true });
}

export async function desuscribirController(req: Request, res: Response) {
  const data = desuscribirSchema.parse(req.body);
  await service.desuscribir(req.auth!.usuarioId, data);
  return ok(res, { desuscrito: true });
}
