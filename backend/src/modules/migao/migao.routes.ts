import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { crearUploaderImagen } from "../../shared/middlewares/upload.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  crearInventarioProductoController,
  editarInventarioProductoController,
  eliminarInventarioProductoController,
  guardarIngredientesProductoController,
  listarInventarioController,
  listarMovimientosInventarioController,
  obtenerIngredientesProductoController,
  registrarMovimientoInventarioController,
} from "./inventario.controller";
import {
  agregarCargoParaLlevarController,
  agregarItemController,
  cambiarMesaController,
  cancelarOrdenController,
  cerrarOrdenController,
  crearCategoriaController,
  crearMesaController,
  crearOrdenController,
  crearProductoController,
  editarItemController,
  editarMesaController,
  editarProductoController,
  eliminarMesaController,
  empezarPrepararController,
  entregarItemController,
  listarCategoriasController,
  listarColaDeCocinaController,
  listarHistorialAdministrativoController,
  listarHistorialDespachadosController,
  listarHistorialOrdenesController,
  listarHistorialPropioController,
  listarItemsActivosController,
  listarMesasController,
  listarOrdenesAbiertasController,
  listarProductosAdminController,
  listarProductosController,
  listarProductosParaLlevarController,
  listarPropinasController,
  marcarCheckItemController,
  marcarOrdenListaController,
  moverMesaController,
  obtenerDetalleOrdenController,
  obtenerResumenDiarioIngresosController,
  reiniciarTodoController,
  repartirPropinasController,
  resetearOrdenesController,
  subirImagenProductoController,
} from "./migao.controller";

export const migaoRouter = Router();
const subirImagenProducto = crearUploaderImagen("productos");

migaoRouter.use(authMiddleware);

migaoRouter.get("/mesas", requirePermission("migao.mesas.ver"), asyncHandler(listarMesasController));
migaoRouter.post("/mesas", requirePermission("migao.mesas.administrar"), asyncHandler(crearMesaController));
migaoRouter.patch("/mesas/:id", requirePermission("migao.mesas.administrar"), asyncHandler(editarMesaController));
migaoRouter.patch(
  "/mesas/:id/posicion",
  requirePermission("migao.mesas.administrar"),
  asyncHandler(moverMesaController),
);
migaoRouter.delete("/mesas/:id", requirePermission("migao.mesas.administrar"), asyncHandler(eliminarMesaController));
// Ver el catálogo es un permiso propio (migao.productos.ver): lo necesita el mesero
// para buscar productos al armar un pedido, y también el Administrador del menú,
// que no necesariamente tiene acceso a órdenes.
migaoRouter.get("/productos", requirePermission("migao.productos.ver"), asyncHandler(listarProductosController));
migaoRouter.post("/productos", requirePermission("migao.productos.crear"), asyncHandler(crearProductoController));
// El Cajero no tiene migao.productos.ver (no ve el catálogo completo): esta
// lista está acotada a los productos marcados "para llevar", lo único que
// puede agregar a una orden desde cobro (ver agregarCargoParaLlevar).
migaoRouter.get(
  "/productos/para-llevar",
  requirePermission("migao.ordenes.agregar_para_llevar"),
  asyncHandler(listarProductosParaLlevarController),
);
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
// Receta del producto (qué ingredientes de migao_inventario_productos
// consume por cada unidad vendida) — mismos permisos que el producto en sí.
migaoRouter.get(
  "/productos/:id/ingredientes",
  requirePermission("migao.productos.ver"),
  asyncHandler(obtenerIngredientesProductoController),
);
migaoRouter.put(
  "/productos/:id/ingredientes",
  requirePermission("migao.productos.editar"),
  asyncHandler(guardarIngredientesProductoController),
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
// Historial separado de cuentas pagadas "administrativo" — exclusivo de
// Root/Super Root, registrado antes de /ordenes/:id por el mismo motivo que
// /ordenes/historial.
migaoRouter.get(
  "/ordenes/historial-administrativo",
  requirePermission("migao.ordenes.pago_administrativo"),
  asyncHandler(listarHistorialAdministrativoController),
);
// Historial separado de propinas — dinero del mesero/personal, exclusivo de
// Root/Super Root.
migaoRouter.get("/propinas", requirePermission("migao.propinas.ver"), asyncHandler(listarPropinasController));
// Repartir (liquidar) las propinas pendientes de un método — mismo permiso
// que ver el historial, ya que esta pantalla ya es exclusiva de Root/Super Root.
migaoRouter.post(
  "/propinas/repartir",
  requirePermission("migao.propinas.ver"),
  asyncHandler(repartirPropinasController),
);
// Subtotal por día y método de pago (efectivo/banco), para agrupar el
// historial de órdenes por día — mismo permiso que ver el historial.
migaoRouter.get(
  "/ordenes/historial-resumen-diario",
  requirePermission("migao.ordenes.ver"),
  asyncHandler(obtenerResumenDiarioIngresosController),
);
migaoRouter.get("/ordenes/:id", requirePermission("migao.ordenes.ver"), asyncHandler(obtenerDetalleOrdenController));
// El mesero cambia la mesa de una orden abierta (ej. los comensales se
// cambiaron de mesa a mitad del pedido).
migaoRouter.patch(
  "/ordenes/:id/mesa",
  requirePermission("migao.ordenes.cambiar_mesa"),
  asyncHandler(cambiarMesaController),
);
migaoRouter.post(
  "/ordenes/:id/items",
  requirePermission("migao.ordenes.agregar_item"),
  asyncHandler(agregarItemController),
);
// Vía acotada para que el Cajero cobre envases/cargos "para llevar" sin darle
// el permiso general de agregar cualquier producto (ver agregarCargoParaLlevar
// en migao.service.ts: rechaza cualquier producto que no esté marcado así).
migaoRouter.post(
  "/ordenes/:id/items/para-llevar",
  requirePermission("migao.ordenes.agregar_para_llevar"),
  asyncHandler(agregarCargoParaLlevarController),
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

// Inventario de Migao: catálogo de insumos "tal como los entrega el
// proveedor" + stock, ver inventario.service.ts. Administrar (crear/editar
// productos, registrar entradas/ajustes) es de Root/Super Root/Cocina; ver
// también lo tiene Administrador (para elegir ingredientes al armar un
// producto del menú).
migaoRouter.get(
  "/inventario/productos",
  requirePermission("migao.inventario.ver"),
  asyncHandler(listarInventarioController),
);
migaoRouter.post(
  "/inventario/productos",
  requirePermission("migao.inventario.administrar"),
  asyncHandler(crearInventarioProductoController),
);
migaoRouter.patch(
  "/inventario/productos/:id",
  requirePermission("migao.inventario.administrar"),
  asyncHandler(editarInventarioProductoController),
);
migaoRouter.delete(
  "/inventario/productos/:id",
  requirePermission("migao.inventario.administrar"),
  asyncHandler(eliminarInventarioProductoController),
);
migaoRouter.get(
  "/inventario/productos/:id/movimientos",
  requirePermission("migao.inventario.ver"),
  asyncHandler(listarMovimientosInventarioController),
);
migaoRouter.post(
  "/inventario/movimientos",
  requirePermission("migao.inventario.administrar"),
  asyncHandler(registrarMovimientoInventarioController),
);
