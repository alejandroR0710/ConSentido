import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import {
  crearUsuarioController,
  editarUsuarioController,
  eliminarUsuarioController,
  listarRolesController,
  listarUsuariosController,
} from "./usuarios.controller";

export const usuariosRouter = Router();

usuariosRouter.use(authMiddleware);

usuariosRouter.get("/", requirePermission("general.usuarios.ver"), asyncHandler(listarUsuariosController));
usuariosRouter.get("/roles", requirePermission("general.usuarios.ver"), asyncHandler(listarRolesController));
usuariosRouter.post("/", requirePermission("general.usuarios.crear"), asyncHandler(crearUsuarioController));
usuariosRouter.patch("/:id", requirePermission("general.usuarios.editar"), asyncHandler(editarUsuarioController));
usuariosRouter.delete("/:id", requirePermission("general.usuarios.eliminar"), asyncHandler(eliminarUsuarioController));
