import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  actualizarParametrosController,
  calcularRecetaController,
  crearCeraController,
  crearFraganciaController,
  crearInsumoVelaController,
  crearPabiloController,
  crearProductoController,
  duplicarProductoController,
  editarCeraController,
  editarFraganciaController,
  editarInsumoVelaController,
  editarPabiloController,
  editarProductoController,
  eliminarProductoController,
  listarCerasAdminController,
  listarCerasController,
  listarFraganciasAdminController,
  listarFraganciasController,
  listarInsumosVelaAdminController,
  listarInsumosVelaController,
  listarPabilosAdminController,
  listarPabilosController,
  listarProductosController,
  obtenerParametrosController,
  obtenerProductoController,
} from "./velas.controller";

export const velasRouter = Router();

velasRouter.use(authMiddleware);
// Exclusiva de Root/Super Root: "velas.ver"/"velas.administrar" nunca se le
// dan a Cajero/Mesero/Cocina/Administrador (ver database/seed.sql).
velasRouter.use(requirePermission("velas.ver"));

velasRouter.get("/ceras", asyncHandler(listarCerasController));
velasRouter.get("/ceras/admin", asyncHandler(listarCerasAdminController));
velasRouter.post("/ceras", requirePermission("velas.administrar"), asyncHandler(crearCeraController));
velasRouter.patch("/ceras/:id", requirePermission("velas.administrar"), asyncHandler(editarCeraController));

velasRouter.get("/fragancias", asyncHandler(listarFraganciasController));
velasRouter.get("/fragancias/admin", asyncHandler(listarFraganciasAdminController));
velasRouter.post("/fragancias", requirePermission("velas.administrar"), asyncHandler(crearFraganciaController));
velasRouter.patch("/fragancias/:id", requirePermission("velas.administrar"), asyncHandler(editarFraganciaController));

velasRouter.get("/pabilos", asyncHandler(listarPabilosController));
velasRouter.get("/pabilos/admin", asyncHandler(listarPabilosAdminController));
velasRouter.post("/pabilos", requirePermission("velas.administrar"), asyncHandler(crearPabiloController));
velasRouter.patch("/pabilos/:id", requirePermission("velas.administrar"), asyncHandler(editarPabiloController));

velasRouter.get("/insumos", asyncHandler(listarInsumosVelaController));
velasRouter.get("/insumos/admin", asyncHandler(listarInsumosVelaAdminController));
velasRouter.post("/insumos", requirePermission("velas.administrar"), asyncHandler(crearInsumoVelaController));
velasRouter.patch("/insumos/:id", requirePermission("velas.administrar"), asyncHandler(editarInsumoVelaController));

velasRouter.get("/parametros", asyncHandler(obtenerParametrosController));
velasRouter.put("/parametros", requirePermission("velas.administrar"), asyncHandler(actualizarParametrosController));

// No persiste nada — la calculadora interactiva pega acá en cada cambio.
velasRouter.post("/calcular", asyncHandler(calcularRecetaController));

velasRouter.get("/productos", asyncHandler(listarProductosController));
velasRouter.get("/productos/:id", asyncHandler(obtenerProductoController));
velasRouter.post("/productos", requirePermission("velas.administrar"), asyncHandler(crearProductoController));
velasRouter.post(
  "/productos/:id/duplicar",
  requirePermission("velas.administrar"),
  asyncHandler(duplicarProductoController),
);
velasRouter.patch("/productos/:id", requirePermission("velas.administrar"), asyncHandler(editarProductoController));
velasRouter.delete(
  "/productos/:id",
  requirePermission("velas.administrar"),
  asyncHandler(eliminarProductoController),
);
