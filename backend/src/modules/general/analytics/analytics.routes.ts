import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import { obtenerAnalyticsMigaoController } from "./analytics.controller";

export const analyticsRouter = Router();

analyticsRouter.use(authMiddleware);

analyticsRouter.get(
  "/migao",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerAnalyticsMigaoController),
);
