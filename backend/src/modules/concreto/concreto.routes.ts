import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarParametrosController,
  calcularController,
  obtenerParametrosController,
} from "./concreto.controller";

export const concretoRouter = Router();

concretoRouter.use(authMiddleware);
// Exclusiva de Root/Super Root, igual que la calculadora de velas:
// "concreto.ver"/"concreto.administrar" nunca se le dan a otro rol (ver seed.sql).
concretoRouter.use(requirePermission("concreto.ver"));

concretoRouter.get("/parametros", asyncHandler(obtenerParametrosController));
concretoRouter.put(
  "/parametros",
  requirePermission("concreto.administrar"),
  asyncHandler(actualizarParametrosController),
);

// No persiste nada — la calculadora interactiva pega acá en cada cambio.
concretoRouter.post("/calcular", asyncHandler(calcularController));
