import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import {
  obtenerAnalyticsMigaoController,
  obtenerAnalyticsGeneralController,
  obtenerAnalyticsConSentidoController,
  obtenerAnalyticsInsumosController,
  obtenerAnalyticsPedidosController,
} from "./analytics.controller";

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

analyticsRouter.get(
  "/general",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsGeneralController),
);

analyticsRouter.get(
  "/migao",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsMigaoController),
);

analyticsRouter.get(
  "/con-sentido",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsConSentidoController),
);

analyticsRouter.get(
  "/insumos",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsInsumosController),
);

analyticsRouter.get(
  "/pedidos",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsPedidosController),
);
