import { Request, Response } from "express";
import { ok, created } from "../../shared/utils/response";
import * as service from "./pedidos.service";
import {
  actualizarParametrosPedidosSchema,
  cambiarEstadoPedidoSchema,
  crearPedidoSchema,
  editarPedidoSchema,
  registrarAbonoPedidoSchema,
} from "./pedidos.schema";

export async function listarPedidosController(req: Request, res: Response) {
  const estado = req.query.estado as string | undefined;
  const vencidos = req.query.vencidos === "true";
  return ok(res, await service.listarPedidos({ estado, vencidos }));
}

export async function obtenerPedidoController(req: Request, res: Response) {
  return ok(res, await service.obtenerPedido(req.params.id));
}

export async function crearPedidoController(req: Request, res: Response) {
  const data = crearPedidoSchema.parse(req.body);
  return created(res, await service.crearPedido(data, req.auth!.usuarioId));
}

export async function editarPedidoController(req: Request, res: Response) {
  const data = editarPedidoSchema.parse(req.body);
  return ok(res, await service.editarPedido(req.params.id, data, req.auth!.usuarioId));
}

export async function cambiarEstadoPedidoController(req: Request, res: Response) {
  const data = cambiarEstadoPedidoSchema.parse(req.body);
  return ok(res, await service.cambiarEstadoPedido(req.params.id, data, req.auth!.usuarioId));
}

export async function registrarAbonoPedidoController(req: Request, res: Response) {
  const data = registrarAbonoPedidoSchema.parse(req.body);
  return created(res, await service.registrarAbono(req.params.id, data, req.auth!.usuarioId));
}

export async function obtenerParametrosPedidosController(_req: Request, res: Response) {
  return ok(res, await service.obtenerParametros());
}

export async function actualizarParametrosPedidosController(req: Request, res: Response) {
  const data = actualizarParametrosPedidosSchema.parse(req.body);
  return ok(res, await service.actualizarParametros(data.intervaloAlarmaMinutos));
}
