import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { crearUploaderImagen } from "../../shared/middlewares/upload.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  agregarItemController,
  cancelarOrdenController,
  cerrarOrdenController,
  crearCategoriaController,
  crearOrdenController,
  crearProductoController,
  editarItemController,
  editarProductoController,
  empezarPrepararController,
  entregarItemController,
  listarCategoriasController,
  listarColaDeCocinaController,
  listarHistorialDespachadosController,
  listarHistorialOrdenesController,
  listarHistorialPropioController,
  listarItemsActivosController,
  listarMesasController,
  listarOrdenesAbiertasController,
  listarProductosAdminController,
  listarProductosController,
  marcarCheckItemController,
  marcarOrdenListaController,
  obtenerDetalleOrdenController,
  reiniciarTodoController,
  resetearOrdenesController,
  subirImagenProductoController,
} from "./migao.controller";

export const migaoRouter = Router();
const subirImagenProducto = crearUploaderImagen("productos");

migaoRouter.use(authMiddleware);

migaoRouter.get("/mesas", requirePermission("migao.ordenes.ver"), asyncHandler(listarMesasController));
// Ver el catálogo es un permiso propio (migao.productos.ver): lo necesita el mesero
// para buscar productos al armar un pedido, y también el Administrador del menú,
// que no necesariamente tiene acceso a órdenes.
migaoRouter.get("/productos", requirePermission("migao.productos.ver"), asyncHandler(listarProductosController));
migaoRouter.post("/productos", requirePermission("migao.productos.crear"), asyncHandler(crearProductoController));
// Categorías del menú (ej. Migaos, Bebidas calientes, Postres): el Administrador las
// crea sobre la marcha al armar el menú, igual que las categorías de gasto en Caja.
migaoRouter.get("/categorias", requirePermission("migao.productos.ver"), asyncHandler(listarCategoriasController));
migaoRouter.post("/categorias", requirePermission("migao.productos.crear"), asyncHandler(crearCategoriaController));
// Listado completo (incluye inactivos) para la pantalla de administración del menú.
migaoRouter.get(
  "/productos/admin",
  requirePermission("migao.productos.editar"),
  asyncHandler(listarProductosAdminController),
);
// Editar o "eliminar" (desactivar, activo:false) un producto — nunca se borra
// físicamente porque puede estar referenciado por órdenes/ventas ya cerradas.
migaoRouter.patch(
  "/productos/:id",
  requirePermission("migao.productos.editar"),
  asyncHandler(editarProductoController),
);
migaoRouter.post(
  "/productos/:id/imagen",
  requirePermission("migao.productos.editar"),
  subirImagenProducto.single("imagen"),
  asyncHandler(subirImagenProductoController),
);
migaoRouter.get("/ordenes", requirePermission("migao.ordenes.ver"), asyncHandler(listarOrdenesAbiertasController));
migaoRouter.post("/ordenes", requirePermission("migao.ordenes.crear"), asyncHandler(crearOrdenController));
// Registrado antes de /ordenes/:id: si no, Express interpretaría "historial" como un id.
migaoRouter.get(
  "/ordenes/historial",
  requirePermission("migao.ordenes.ver"),
  asyncHandler(listarHistorialOrdenesController),
);
// "Mi historial": el mesero solo ve las órdenes que él mismo creó y que ya
// Caja cerró o canceló (mientras siguen abiertas no aparecen acá, solo en la
// lista activa normal).
migaoRouter.get(
  "/ordenes/historial-propio",
  requirePermission("migao.ordenes.ver"),
  asyncHandler(listarHistorialPropioController),
);
migaoRouter.get("/ordenes/:id", requirePermission("migao.ordenes.ver"), asyncHandler(obtenerDetalleOrdenController));
migaoRouter.post(
  "/ordenes/:id/items",
  requirePermission("migao.ordenes.agregar_item"),
  asyncHandler(agregarItemController),
);
// Ítems activos (pendiente/preparando/listo) de todas las órdenes: el mesero hace
// polling de esto para notificarse con sonido cuando cocina avanza un ítem.
migaoRouter.get("/items/activos", requirePermission("migao.ordenes.ver"), asyncHandler(listarItemsActivosController));
// Editar/cancelar un ítem es del Mesero; queda registrado en orden_historial y
// regresa el ítem a "pendiente" para que cocina lo vuelva a ver.
migaoRouter.patch(
  "/items/:id",
  requirePermission("migao.ordenes.editar_item"),
  asyncHandler(editarItemController),
);
// El mesero marca como entregado un ítem que cocina ya dejó listo.
migaoRouter.patch(
  "/items/:id/entregar",
  requirePermission("migao.ordenes.entregar_item"),
  asyncHandler(entregarItemController),
);
// Cerrar la mesa/orden es EXCLUSIVO del Cajero: este permiso solo se asigna a ese rol.
migaoRouter.post(
  "/ordenes/:id/cerrar",
  requirePermission("migao.ordenes.cerrar"),
  asyncHandler(cerrarOrdenController),
);
// Cancelar la orden completa (ej. el cliente ya no quiere pedir) también es del Cajero.
migaoRouter.post(
  "/ordenes/:id/cancelar",
  requirePermission("migao.ordenes.cancelar"),
  asyncHandler(cancelarOrdenController),
);
// Reset exclusivo de Super Root: borra por completo el historial de órdenes.
// Registrado antes de /ordenes/:id para que "reset" no se interprete como un id.
migaoRouter.post(
  "/ordenes/reset",
  requirePermission("migao.ordenes.resetear"),
  asyncHandler(resetearOrdenesController),
);

// Reinicio total exclusivo de Super Root: borra TODO el historial de Migao y
// de Caja General de una sola vez (ver migao.repository.ts::reiniciarTodoCompleto).
migaoRouter.post(
  "/reiniciar-todo",
  requirePermission("general.sistema.reiniciar_todo"),
  asyncHandler(reiniciarTodoController),
);

// Cocina: solo ve la cola de ítems pendientes/en preparación de todas las órdenes.
// No tiene acceso a migao.ordenes.* (no ve cobros ni cierra mesas).
migaoRouter.get("/cocina/items", requirePermission("migao.cocina.ver"), asyncHandler(listarColaDeCocinaController));
// Historial de pedidos ya despachados (listo/servido) — pantalla de consulta, no
// cambia ningún estado.
migaoRouter.get(
  "/cocina/historial",
  requirePermission("migao.cocina.ver"),
  asyncHandler(listarHistorialDespachadosController),
);
// La orden completa pasa a "preparando" de una sola vez (no producto por producto).
migaoRouter.post(
  "/ordenes/:id/empezar-preparar",
  requirePermission("migao.cocina.actualizar_estado"),
  asyncHandler(empezarPrepararController),
);
// Check individual por producto mientras la orden está en preparando.
migaoRouter.patch(
  "/items/:id/check",
  requirePermission("migao.cocina.actualizar_estado"),
  asyncHandler(marcarCheckItemController),
);
// Marcar TODA la orden como lista: el backend valida que todo esté checkeado.
migaoRouter.post(
  "/ordenes/:id/marcar-listo",
  requirePermission("migao.cocina.actualizar_estado"),
  asyncHandler(marcarOrdenListaController),
);
