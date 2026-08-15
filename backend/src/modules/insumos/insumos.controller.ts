import { Request, Response } from "express";
import { Errors } from "../../shared/utils/app-error";
import { rutaPublicaImagen } from "../../shared/middlewares/upload.middleware";
import { created, ok } from "../../shared/utils/response";
import { actualizarInsumoSchema, crearInsumoSchema, registrarMovimientoSchema } from "./insumos.schema";
import * as service from "./insumos.service";

export async function listarInsumosController(_req: Request, res: Response) {
  const insumos = await service.listarInsumos();
  return ok(res, insumos);
}

export async function obtenerInsumoController(req: Request, res: Response) {
  const insumo = await service.obtenerInsumo(req.params.id);
  return ok(res, insumo);
}

export async function crearInsumoController(req: Request, res: Response) {
  const data = crearInsumoSchema.parse(req.body);
  const insumo = await service.crearInsumo(data);
  return created(res, insumo);
}

export async function actualizarInsumoController(req: Request, res: Response) {
  const data = actualizarInsumoSchema.parse(req.body);
  const insumo = await service.actualizarInsumo(req.params.id, data);
  return ok(res, insumo);
}

export async function listarAlmacenesController(_req: Request, res: Response) {
  const almacenes = await service.listarAlmacenes();
  return ok(res, almacenes);
}

export async function listarMovimientosController(req: Request, res: Response) {
  const desde = (req.query.desde as string) ?? new Date().toISOString().slice(0, 10);
  const hasta = (req.query.hasta as string) ?? desde;
  const movimientos = await service.listarMovimientos(desde, hasta);
  return ok(res, movimientos);
}

export async function listarInsumosAdminController(_req: Request, res: Response) {
  const insumos = await service.listarInsumosAdmin();
  return ok(res, insumos);
}

export async function subirImagenInsumoController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("insumos", req.file.filename);
  const insumo = await service.actualizarImagenInsumo(req.params.id, imagenUrl);
  return ok(res, insumo);
}

export async function registrarMovimientoController(req: Request, res: Response) {
  const data = registrarMovimientoSchema.parse(req.body);
  const resultado = await service.registrarMovimiento(data, req.auth?.usuarioId);
  return created(res, resultado);
}
