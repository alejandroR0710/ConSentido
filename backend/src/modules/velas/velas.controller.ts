import { Request, Response } from "express";
import { created, ok } from "../../shared/utils/response";
import {
  actualizarCeraSchema,
  actualizarFraganciaSchema,
  actualizarInsumoVelaSchema,
  actualizarPabiloSchema,
  actualizarParametrosSchema,
  actualizarProductoVelaSchema,
  calcularRecetaSchema,
  crearCeraSchema,
  crearFraganciaSchema,
  crearInsumoVelaSchema,
  crearPabiloSchema,
  crearProductoVelaSchema,
} from "./velas.schema";
import * as service from "./velas.service";

export async function listarCerasController(_req: Request, res: Response) {
  return ok(res, await service.listarCeras());
}
export async function listarCerasAdminController(_req: Request, res: Response) {
  return ok(res, await service.listarCerasAdmin());
}
export async function crearCeraController(req: Request, res: Response) {
  const data = crearCeraSchema.parse(req.body);
  return created(res, await service.crearCera(data));
}
export async function editarCeraController(req: Request, res: Response) {
  const data = actualizarCeraSchema.parse(req.body);
  return ok(res, await service.editarCera(req.params.id, data));
}

export async function listarFraganciasController(_req: Request, res: Response) {
  return ok(res, await service.listarFragancias());
}
export async function listarFraganciasAdminController(_req: Request, res: Response) {
  return ok(res, await service.listarFraganciasAdmin());
}
export async function crearFraganciaController(req: Request, res: Response) {
  const data = crearFraganciaSchema.parse(req.body);
  return created(res, await service.crearFragancia(data));
}
export async function editarFraganciaController(req: Request, res: Response) {
  const data = actualizarFraganciaSchema.parse(req.body);
  return ok(res, await service.editarFragancia(req.params.id, data));
}

export async function listarPabilosController(_req: Request, res: Response) {
  return ok(res, await service.listarPabilos());
}
export async function listarPabilosAdminController(_req: Request, res: Response) {
  return ok(res, await service.listarPabilosAdmin());
}
export async function crearPabiloController(req: Request, res: Response) {
  const data = crearPabiloSchema.parse(req.body);
  return created(res, await service.crearPabilo(data));
}
export async function editarPabiloController(req: Request, res: Response) {
  const data = actualizarPabiloSchema.parse(req.body);
  return ok(res, await service.editarPabilo(req.params.id, data));
}

export async function listarInsumosVelaController(_req: Request, res: Response) {
  return ok(res, await service.listarInsumosVela());
}
export async function listarInsumosVelaAdminController(_req: Request, res: Response) {
  return ok(res, await service.listarInsumosVelaAdmin());
}
export async function crearInsumoVelaController(req: Request, res: Response) {
  const data = crearInsumoVelaSchema.parse(req.body);
  return created(res, await service.crearInsumoVela(data));
}
export async function editarInsumoVelaController(req: Request, res: Response) {
  const data = actualizarInsumoVelaSchema.parse(req.body);
  return ok(res, await service.editarInsumoVela(req.params.id, data));
}

export async function obtenerParametrosController(_req: Request, res: Response) {
  return ok(res, await service.obtenerParametros());
}
export async function actualizarParametrosController(req: Request, res: Response) {
  const data = actualizarParametrosSchema.parse(req.body);
  return ok(res, await service.actualizarParametros(data));
}

export async function calcularRecetaController(req: Request, res: Response) {
  const data = calcularRecetaSchema.parse(req.body);
  return ok(res, await service.calcularCostoReceta(data));
}

export async function listarProductosController(_req: Request, res: Response) {
  return ok(res, await service.listarProductos());
}
export async function obtenerProductoController(req: Request, res: Response) {
  return ok(res, await service.obtenerProducto(req.params.id));
}
export async function crearProductoController(req: Request, res: Response) {
  const data = crearProductoVelaSchema.parse(req.body);
  return created(res, await service.crearProducto(req.auth!.usuarioId, data));
}
export async function duplicarProductoController(req: Request, res: Response) {
  return created(res, await service.duplicarProducto(req.params.id));
}
export async function editarProductoController(req: Request, res: Response) {
  const data = actualizarProductoVelaSchema.parse(req.body);
  return ok(res, await service.editarProducto(req.params.id, data));
}
export async function eliminarProductoController(req: Request, res: Response) {
  return ok(res, await service.eliminarProducto(req.params.id));
}
