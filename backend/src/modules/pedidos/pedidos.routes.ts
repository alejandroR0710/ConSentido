import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarParametrosPedidosController,
  cambiarEstadoPedidoController,
  crearPedidoController,
  crearRotuloController,
  editarPedidoController,
  listarPedidosController,
  listarRotulosController,
  obtenerFacturaPedidoController,
  obtenerParametrosPedidosController,
  obtenerPedidoController,
  registrarAbonoPedidoController,
} from "./pedidos.controller";

export const pedidosRouter = Router();

pedidosRouter.use(authMiddleware);
pedidosRouter.use(requirePermission("pedidos.ver"));

// Registradas antes de /:id para que "parametros"/"rotulos" no se
// interpreten como un id.
pedidosRouter.get("/parametros", asyncHandler(obtenerParametrosPedidosController));
pedidosRouter.put(
  "/parametros",
  requirePermission("pedidos.administrar_parametros"),
  asyncHandler(actualizarParametrosPedidosController),
);

// Rótulos sueltos, sin pedido asociado — mismo permiso que crear un pedido.
pedidosRouter.get("/rotulos", asyncHandler(listarRotulosController));
pedidosRouter.post("/rotulos", requirePermission("pedidos.crear"), asyncHandler(crearRotuloController));

pedidosRouter.get("/", asyncHandler(listarPedidosController));
pedidosRouter.post("/", requirePermission("pedidos.crear"), asyncHandler(crearPedidoController));
pedidosRouter.get("/:id", asyncHandler(obtenerPedidoController));
pedidosRouter.get("/:id/factura", asyncHandler(obtenerFacturaPedidoController));
pedidosRouter.patch("/:id", requirePermission("pedidos.crear"), asyncHandler(editarPedidoController));
pedidosRouter.post(
  "/:id/estado",
  requirePermission("pedidos.cambiar_estado"),
  asyncHandler(cambiarEstadoPedidoController),
);
pedidosRouter.post("/:id/abonos", requirePermission("pedidos.crear"), asyncHandler(registrarAbonoPedidoController));
