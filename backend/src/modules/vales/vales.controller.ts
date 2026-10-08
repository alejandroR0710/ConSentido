import { Request, Response } from "express";
import { ok, created } from "../../shared/utils/response";
import * as service from "./vales.service";
import { crearValeSchema, cobrarValeSchema, reponerValeSchema } from "./vales.schema";

export async function listarValesController(req: Request, res: Response) {
  const tipo = req.query.tipo as "pago" | "deuda" | undefined;
  const fuente = req.query.fuente as string | undefined;
  const estado = req.query.estado as "activo" | "resuelto" | "anulado" | undefined;
  return ok(res, await service.listarVales({ tipo, fuente, estado }));
}

export async function obtenerValeController(req: Request, res: Response) {
  return ok(res, await service.obtenerVale(req.params.id));
}

export async function crearValeController(req: Request, res: Response) {
  const data = crearValeSchema.parse(req.body);
  return created(res, await service.crearVale(data, req.auth!.usuarioId));
}

export async function marcarValeRepuestoController(req: Request, res: Response) {
  const data = reponerValeSchema.parse(req.body);
  return ok(res, await service.marcarValeRepuesto(req.params.id, data, req.auth!.usuarioId));
}

export async function cobrarValeController(req: Request, res: Response) {
  const data = cobrarValeSchema.parse(req.body);
  return ok(res, await service.cobrarVale(req.params.id, data, req.auth!.usuarioId));
}

export async function anularValeController(req: Request, res: Response) {
  return ok(res, await service.anularVale(req.params.id, req.auth!.usuarioId));
}
