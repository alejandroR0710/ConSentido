import { Request, Response } from "express";
import { created, ok } from "../../../shared/utils/response";
import {
  abrirTurnoSchema,
  cerrarTurnoSchema,
  crearCategoriaGastoSchema,
  editarMetodoPagoMovimientoSchema,
  historialCajaSchema,
  registrarEgresoSchema,
  registrarIngresoSchema,
  resetearCajaSchema,
} from "./caja.schema";
import * as service from "./caja.service";

export async function obtenerTurnoAbiertoController(_req: Request, res: Response) {
  const turno = await service.obtenerTurnoAbierto();
  return ok(res, turno);
}

export async function obtenerProyeccionAperturaController(_req: Request, res: Response) {
  const proyeccion = await service.obtenerProyeccionApertura();
  return ok(res, proyeccion);
}

export async function abrirTurnoController(req: Request, res: Response) {
  const data = abrirTurnoSchema.parse(req.body ?? {});
  const turno = await service.abrirTurno(req.auth!.usuarioId, data);
  return created(res, turno);
}

export async function cerrarTurnoController(req: Request, res: Response) {
  const data = cerrarTurnoSchema.parse(req.body);
  const turno = await service.cerrarTurno(req.params.id, data);
  return ok(res, turno);
}

export async function obtenerResumenTurnoController(req: Request, res: Response) {
  const resumen = await service.obtenerResumenTurno(req.params.id);
  return ok(res, resumen);
}

export async function registrarIngresoController(req: Request, res: Response) {
  const data = registrarIngresoSchema.parse(req.body);
  const movimientos = await service.registrarIngreso(data, req.auth!.usuarioId);
  return created(res, movimientos);
}

export async function registrarEgresoController(req: Request, res: Response) {
  const data = registrarEgresoSchema.parse(req.body);
  const movimientos = await service.registrarEgreso(data, req.auth!.usuarioId);
  return created(res, movimientos);
}

export async function listarCategoriasGastoController(_req: Request, res: Response) {
  const categorias = await service.listarCategoriasGasto();
  return ok(res, categorias);
}

export async function crearCategoriaGastoController(req: Request, res: Response) {
  const { nombre } = crearCategoriaGastoSchema.parse(req.body);
  const categoria = await service.crearCategoriaGasto(nombre);
  return created(res, categoria);
}

export async function editarMetodoPagoMovimientoController(req: Request, res: Response) {
  const data = editarMetodoPagoMovimientoSchema.parse(req.body);
  const movimientos = await service.editarMetodoPagoMovimiento(Number(req.params.id), data);
  return ok(res, movimientos);
}

export async function resetearCajaController(req: Request, res: Response) {
  resetearCajaSchema.parse(req.body);
  const resultado = await service.resetearCaja(req.auth!.usuarioId);
  return ok(res, resultado);
}

export async function obtenerHistorialCajaController(req: Request, res: Response) {
  const { anio } = historialCajaSchema.parse(req.query);
  const historial = await service.obtenerHistorialAnual(anio);
  return ok(res, historial);
}
