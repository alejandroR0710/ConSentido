import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  registrarVentaController,
  listarVentasController,
  obtenerVentaController,
} from "./con_sentido.controller";

export const conSentidoRouter = Router();

conSentidoRouter.use(authMiddleware);

conSentidoRouter.get("/ventas", asyncHandler(listarVentasController));
conSentidoRouter.get("/ventas/:id", asyncHandler(obtenerVentaController));
conSentidoRouter.post("/ventas", asyncHandler(registrarVentaController));
