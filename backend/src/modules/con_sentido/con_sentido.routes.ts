import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  crearClienteController,
  crearProductoController,
  editarProductoController,
  listarClientesController,
  listarProductosController,
  listarVentasController,
  obtenerFacturaVentaController,
  obtenerVentaController,
  registrarVentaController,
} from "./con_sentido.controller";

export const conSentidoRouter = Router();

conSentidoRouter.use(authMiddleware);

conSentidoRouter.get("/productos", requirePermission("con_sentido.productos.ver"), asyncHandler(listarProductosController));
conSentidoRouter.post("/productos", requirePermission("con_sentido.productos.crear"), asyncHandler(crearProductoController));
conSentidoRouter.patch(
  "/productos/:id",
  requirePermission("con_sentido.productos.editar"),
  asyncHandler(editarProductoController),
);

conSentidoRouter.get("/clientes", requirePermission("con_sentido.clientes.ver"), asyncHandler(listarClientesController));
conSentidoRouter.post("/clientes", requirePermission("con_sentido.clientes.crear"), asyncHandler(crearClienteController));

conSentidoRouter.get("/ventas", requirePermission("con_sentido.ventas.ver"), asyncHandler(listarVentasController));
conSentidoRouter.get("/ventas/:id", requirePermission("con_sentido.ventas.ver"), asyncHandler(obtenerVentaController));
conSentidoRouter.get(
  "/ventas/:id/factura",
  requirePermission("con_sentido.ventas.ver"),
  asyncHandler(obtenerFacturaVentaController),
);
conSentidoRouter.post("/ventas", requirePermission("con_sentido.ventas.crear"), asyncHandler(registrarVentaController));
