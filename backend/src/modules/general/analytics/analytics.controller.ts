import { Request, Response } from "express";
import { ok } from "../../../shared/utils/response";
import { analyticsRangoSchema } from "./analytics.schema";
import * as service from "./analytics.service";

export async function obtenerAnalyticsMigaoController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsMigao(desde, hasta);
  return ok(res, analytics);
}

export async function obtenerAnalyticsGeneralController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsGeneral(desde, hasta);
  return ok(res, analytics);
}

export async function obtenerAnalyticsConSentidoController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsConSentido(desde, hasta);
  return ok(res, analytics);
}

export async function obtenerAnalyticsInsumosController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsInsumos(desde, hasta);
  return ok(res, analytics);
}

export async function obtenerAnalyticsPedidosController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsPedidos(desde, hasta);
  return ok(res, analytics);
}
