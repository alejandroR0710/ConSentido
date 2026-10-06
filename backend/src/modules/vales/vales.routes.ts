import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  anularValeController,
  crearValeController,
  listarValesController,
  marcarValeRepuestoController,
  obtenerValeController,
} from "./vales.controller";

export const valesRouter = Router();

valesRouter.use(authMiddleware);
valesRouter.use(requirePermission("vales.ver"));

valesRouter.get("/", asyncHandler(listarValesController));
valesRouter.post("/", requirePermission("vales.crear"), asyncHandler(crearValeController));
valesRouter.get("/:id", asyncHandler(obtenerValeController));
valesRouter.post(
  "/:id/reponer",
  requirePermission("vales.marcar_repuesto"),
  asyncHandler(marcarValeRepuestoController),
);
valesRouter.post("/:id/anular", requirePermission("vales.anular"), asyncHandler(anularValeController));
