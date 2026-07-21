import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import {
  desuscribirController,
  obtenerClavePublicaController,
  suscribirController,
} from "./notificaciones.controller";

export const notificacionesRouter = Router();

notificacionesRouter.use(authMiddleware);

// Cualquier usuario logueado administra sus propias suscripciones — no hace
// falta un permiso especial, es autoservicio (ver notificaciones.service.ts).
notificacionesRouter.get("/clave-publica", asyncHandler(obtenerClavePublicaController));
notificacionesRouter.post("/suscribir", asyncHandler(suscribirController));
notificacionesRouter.delete("/suscribir", asyncHandler(desuscribirController));
