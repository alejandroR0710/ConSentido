import { Request, Response } from "express";
import { ok } from "../../shared/utils/response";
import { reportesRangoSchema, reportesVentasFiltrosSchema } from "./reportes.schema";
import * as service from "./reportes.service";

export async function obtenerResumenController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const resumen = await service.obtenerResumen(desde, hasta);
  return ok(res, resumen);
}

export async function obtenerVentasController(req: Request, res: Response) {
  const filtros = reportesVentasFiltrosSchema.parse(req.query);
  const ventas = await service.obtenerVentas(filtros);
  return ok(res, ventas);
}

export async function obtenerVentasPorTipoController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const ventasPorTipo = await service.obtenerVentasPorTipo(desde, hasta);
  return ok(res, ventasPorTipo);
}
