import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarAreaCategoriaController,
  crearClienteController,
  crearProductoController,
  editarProductoController,
  listarCategoriasConAreaController,
  listarClientesController,
  listarProductosController,
  listarVentasController,
  obtenerFacturaVentaController,
  obtenerVentaController,
  registrarVentaController,
  vincularMesaController,
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

// Puerta 2 de la venta combinada mesa + Con Sentido — ver
// docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
conSentidoRouter.post(
  "/vincular-mesa",
  requirePermission("con_sentido.ventas.vincular_mesa"),
  asyncHandler(vincularMesaController),
);

// Administración del área (módulo) por defecto de cada categoría de producto
// — ver con_sentido.repository.ts::listarCategoriasConArea.
conSentidoRouter.get(
  "/categorias",
  requirePermission("con_sentido.categorias.administrar"),
  asyncHandler(listarCategoriasConAreaController),
);
conSentidoRouter.patch(
  "/categorias/:id",
  requirePermission("con_sentido.categorias.administrar"),
  asyncHandler(actualizarAreaCategoriaController),
);
