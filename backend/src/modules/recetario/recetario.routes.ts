import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { crearUploaderImagen } from "../../shared/middlewares/upload.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  crearCategoriaController,
  crearRecetaController,
  editarRecetaController,
  eliminarRecetaController,
  listarCategoriasController,
  listarRecetasController,
  obtenerRecetaController,
  subirImagenEmplatadoController,
  subirImagenPrincipalController,
} from "./recetario.controller";

export const recetarioRouter = Router();
const subirImagenRecetario = crearUploaderImagen("recetario");

recetarioRouter.use(authMiddleware);
recetarioRouter.use(requirePermission("recetario.ver"));

recetarioRouter.get("/categorias", asyncHandler(listarCategoriasController));
recetarioRouter.post(
  "/categorias",
  requirePermission("recetario.administrar"),
  asyncHandler(crearCategoriaController),
);
recetarioRouter.get("/recetas", asyncHandler(listarRecetasController));
recetarioRouter.get("/recetas/:id", asyncHandler(obtenerRecetaController));
recetarioRouter.post("/recetas", requirePermission("recetario.administrar"), asyncHandler(crearRecetaController));
recetarioRouter.patch(
  "/recetas/:id",
  requirePermission("recetario.administrar"),
  asyncHandler(editarRecetaController),
);
recetarioRouter.delete(
  "/recetas/:id",
  requirePermission("recetario.administrar"),
  asyncHandler(eliminarRecetaController),
);
recetarioRouter.post(
  "/recetas/:id/imagen-principal",
  requirePermission("recetario.administrar"),
  subirImagenRecetario.single("imagen"),
  asyncHandler(subirImagenPrincipalController),
);
recetarioRouter.post(
  "/recetas/:id/imagen-emplatado",
  requirePermission("recetario.administrar"),
  subirImagenRecetario.single("imagen"),
  asyncHandler(subirImagenEmplatadoController),
);
