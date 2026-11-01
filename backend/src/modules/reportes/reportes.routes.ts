import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  obtenerCierreCajaController,
  obtenerGastosController,
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

reportesRouter.get(
  "/gastos",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerGastosController),
);

reportesRouter.get(
  "/cierre-caja",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerCierreCajaController),
);
