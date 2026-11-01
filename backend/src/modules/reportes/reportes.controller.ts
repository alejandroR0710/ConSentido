import { Request, Response } from "express";
import { ok } from "../../shared/utils/response";
import {
  reportesCierreCajaSchema,
  reportesGastosFiltrosSchema,
  reportesPrestamosFiltrosSchema,
  reportesRangoSchema,
  reportesVentasFiltrosSchema,
} from "./reportes.schema";
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

export async function obtenerGastosController(req: Request, res: Response) {
  const filtros = reportesGastosFiltrosSchema.parse(req.query);
  const gastos = await service.obtenerGastos(filtros);
  return ok(res, gastos);
}

export async function obtenerConciliacionController(req: Request, res: Response) {
  const { desde, hasta } = reportesRangoSchema.parse(req.query);
  const conciliacion = await service.obtenerConciliacion(desde, hasta);
  return ok(res, conciliacion);
}

export async function obtenerCierreCajaController(req: Request, res: Response) {
  const { mes } = reportesCierreCajaSchema.parse(req.query);
  const cierreCaja = await service.obtenerCierreCaja(mes);
  return ok(res, cierreCaja);
}

export async function obtenerPrestamosController(req: Request, res: Response) {
  const { destinatarioUsuarioId } = reportesPrestamosFiltrosSchema.parse(req.query);
  const prestamos = await service.obtenerPrestamos(destinatarioUsuarioId);
  return ok(res, prestamos);
}
