import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  obtenerResumenController,
  obtenerVentasController,
  obtenerVentasPorTipoController,
} from "./reportes.controller";

export const reportesRouter = Router();
reportesRouter.use(authMiddleware);

reportesRouter.get(
  "/resumen",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerResumenController),
);

reportesRouter.get(
  "/ventas",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerVentasController),
);

reportesRouter.get(
  "/ventas-por-tipo",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerVentasPorTipoController),
);
