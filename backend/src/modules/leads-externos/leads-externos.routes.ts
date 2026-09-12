import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import { enviarLeadController } from "./leads-externos.controller";

export const leadsExternosRouter = Router();

leadsExternosRouter.use(authMiddleware);
// Sin permiso dedicado a propósito: el botón vive en el header para
// cualquier usuario logueado (recepción, cajero, admin), no es un módulo
// del menú lateral.
leadsExternosRouter.post("/", asyncHandler(enviarLeadController));
