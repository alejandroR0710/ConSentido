import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { crearUploaderImagen } from "../../shared/middlewares/upload.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarInsumoController,
  crearInsumoController,
  listarAlmacenesController,
  listarInsumosAdminController,
  listarInsumosController,
  obtenerInsumoController,
  registrarMovimientoController,
  subirImagenInsumoController,
} from "./insumos.controller";

export const insumosRouter = Router();
const subirImagen = crearUploaderImagen("insumos");

insumosRouter.use(authMiddleware);

insumosRouter.get("/", requirePermission("insumos.insumos.ver"), asyncHandler(listarInsumosController));
insumosRouter.get("/almacenes", requirePermission("insumos.insumos.ver"), asyncHandler(listarAlmacenesController));
// Listado completo (incluye inactivos), antes de "/:id" para que no lo capture como id.
insumosRouter.get(
  "/admin",
  requirePermission("insumos.insumos.editar"),
  asyncHandler(listarInsumosAdminController),
);
insumosRouter.get("/:id", requirePermission("insumos.insumos.ver"), asyncHandler(obtenerInsumoController));
insumosRouter.post("/", requirePermission("insumos.insumos.crear"), asyncHandler(crearInsumoController));
insumosRouter.patch("/:id", requirePermission("insumos.insumos.editar"), asyncHandler(actualizarInsumoController));
insumosRouter.post(
  "/:id/imagen",
  requirePermission("insumos.insumos.editar"),
  subirImagen.single("imagen"),
  asyncHandler(subirImagenInsumoController),
);
insumosRouter.post(
  "/movimientos",
  requirePermission("insumos.movimientos.crear"),
  asyncHandler(registrarMovimientoController),
);
