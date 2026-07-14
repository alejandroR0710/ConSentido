import { Request, Response } from "express";
import { ok } from "../../../shared/utils/response";
import { analyticsRangoSchema } from "./analytics.schema";
import * as service from "./analytics.service";

export async function obtenerAnalyticsMigaoController(req: Request, res: Response) {
  const { desde, hasta } = analyticsRangoSchema.parse(req.query);
  const analytics = await service.obtenerAnalyticsMigao(desde, hasta);
  return ok(res, analytics);
}
