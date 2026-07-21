import { Request, Response } from "express";
import { created, ok } from "../../shared/utils/response";
import {
  crearInventarioProductoSchema,
  editarInventarioProductoSchema,
  guardarIngredientesSchema,
  registrarMovimientoInventarioSchema,
} from "./inventario.schema";
import * as service from "./inventario.service";

export async function listarInventarioController(_req: Request, res: Response) {
  const productos = await service.listarProductos();
  return ok(res, productos);
}

export async function crearInventarioProductoController(req: Request, res: Response) {
  const data = crearInventarioProductoSchema.parse(req.body);
  const producto = await service.crearProducto(data);
  return created(res, producto);
}

export async function editarInventarioProductoController(req: Request, res: Response) {
  const data = editarInventarioProductoSchema.parse(req.body);
  const producto = await service.editarProducto(req.params.id, data);
  return ok(res, producto);
}

export async function registrarMovimientoInventarioController(req: Request, res: Response) {
  const data = registrarMovimientoInventarioSchema.parse(req.body);
  const resultado = await service.registrarMovimiento(data, req.auth!.usuarioId);
  return created(res, resultado);
}

export async function listarMovimientosInventarioController(req: Request, res: Response) {
  const movimientos = await service.listarMovimientos(req.params.id);
  return ok(res, movimientos);
}

export async function obtenerIngredientesProductoController(req: Request, res: Response) {
  const ingredientes = await service.obtenerIngredientesDeProducto(req.params.id);
  return ok(res, ingredientes);
}

export async function guardarIngredientesProductoController(req: Request, res: Response) {
  const { ingredientes } = guardarIngredientesSchema.parse(req.body);
  await service.guardarIngredientesDeProducto(req.params.id, ingredientes);
  return ok(res, { guardado: true });
}
