import { Request, Response } from "express";
import { rutaPublicaImagen } from "../../shared/middlewares/upload.middleware";
import { Errors } from "../../shared/utils/app-error";
import { created, ok } from "../../shared/utils/response";
import {
  agregarItemSchema,
  cambiarMesaSchema,
  cerrarOrdenSchema,
  checkItemSchema,
  crearCategoriaProductoSchema,
  crearCotizacionSchema,
  crearMesaSchema,
  crearOrdenSchema,
  crearProductoSchema,
  editarItemSchema,
  editarMesaSchema,
  editarProductoSchema,
  iniciarCobroSchema,
  pagarItemsSchema,
  posicionMesaSchema,
  registrarAbonoSchema,
  reiniciarTodoSchema,
  repartirPropinasSchema,
  resetearOrdenesSchema,
} from "./migao.schema";
import * as service from "./migao.service";

export async function listarCategoriasController(_req: Request, res: Response) {
  const categorias = await service.listarCategorias();
  return ok(res, categorias);
}

export async function crearCategoriaController(req: Request, res: Response) {
  const data = crearCategoriaProductoSchema.parse(req.body);
  const categoria = await service.crearCategoria(data.nombre);
  return created(res, categoria);
}

export async function listarMesasController(_req: Request, res: Response) {
  const mesas = await service.listarMesas();
  return ok(res, mesas);
}

export async function crearMesaController(req: Request, res: Response) {
  const data = crearMesaSchema.parse(req.body);
  const mesa = await service.crearMesa(data);
  return created(res, mesa);
}

export async function moverMesaController(req: Request, res: Response) {
  const data = posicionMesaSchema.parse(req.body);
  const mesa = await service.moverMesa(Number(req.params.id), data);
  return ok(res, mesa);
}

export async function editarMesaController(req: Request, res: Response) {
  const data = editarMesaSchema.parse(req.body);
  const mesa = await service.editarMesa(Number(req.params.id), data);
  return ok(res, mesa);
}

export async function eliminarMesaController(req: Request, res: Response) {
  await service.eliminarMesa(Number(req.params.id));
  return ok(res, { eliminada: true });
}

export async function listarOrdenesAbiertasController(_req: Request, res: Response) {
  const ordenes = await service.listarOrdenesAbiertas();
  return ok(res, ordenes);
}

export async function listarHistorialOrdenesController(_req: Request, res: Response) {
  const ordenes = await service.listarHistorialOrdenes();
  return ok(res, ordenes);
}

// Historial acotado al mesero autenticado (a diferencia del anterior, que ve
// todo el Cajero): solo sus propias órdenes ya cerradas o canceladas.
export async function listarHistorialPropioController(req: Request, res: Response) {
  const ordenes = await service.listarHistorialOrdenes(req.auth!.usuarioId);
  return ok(res, ordenes);
}

// Historial separado de cuentas pagadas "administrativo" (no generan ingreso
// en Caja General) — exclusivo de Root/Super Root, ver migao.routes.ts.
export async function listarHistorialAdministrativoController(_req: Request, res: Response) {
  const ordenes = await service.listarHistorialAdministrativo();
  return ok(res, ordenes);
}

// Historial separado de propinas — dinero del mesero/personal, exclusivo de
// Root/Super Root (migao.propinas.ver), ver migao.routes.ts.
export async function listarPropinasController(_req: Request, res: Response) {
  const propinas = await service.listarPropinas();
  return ok(res, propinas);
}

// Pendiente de repartir de un método, agrupado por día — para elegir qué
// días concretos entran en el reparto (ver PropinasPage).
export async function listarPendientesPropinasPorDiaController(_req: Request, res: Response) {
  const pendientes = await service.listarPendientesPropinasPorDia();
  return ok(res, pendientes);
}

// Reparte (liquida) las propinas pendientes de un método — efectivo y banco
// por separado, ver migao.service.ts::repartirPropinas.
export async function repartirPropinasController(req: Request, res: Response) {
  const data = repartirPropinasSchema.parse(req.body);
  const liquidacion = await service.repartirPropinas(req.auth!.usuarioId, data);
  return ok(res, liquidacion);
}

// Historial de a quién se le entregó cuánto — mismo permiso que ver el
// historial general de propinas.
export async function listarEntregasPropinasController(_req: Request, res: Response) {
  const entregas = await service.listarEntregasPropinas();
  return ok(res, entregas);
}

export async function obtenerResumenDiarioIngresosController(_req: Request, res: Response) {
  const dias = await service.obtenerResumenDiarioIngresos();
  return ok(res, dias);
}

export async function crearOrdenController(req: Request, res: Response) {
  const data = crearOrdenSchema.parse(req.body);
  const orden = await service.crearOrden(req.auth!.usuarioId, data);
  return created(res, orden);
}

export async function agregarItemController(req: Request, res: Response) {
  const data = agregarItemSchema.parse(req.body);
  const item = await service.agregarItem(req.params.id, data, req.auth!.usuarioId);
  return created(res, item);
}

export async function listarProductosParaLlevarController(_req: Request, res: Response) {
  const productos = await service.listarProductosParaLlevar();
  return ok(res, productos);
}

export async function agregarCargoParaLlevarController(req: Request, res: Response) {
  const data = agregarItemSchema.parse(req.body);
  const item = await service.agregarCargoParaLlevar(req.params.id, data, req.auth!.usuarioId);
  return created(res, item);
}

export async function editarItemController(req: Request, res: Response) {
  const data = editarItemSchema.parse(req.body);
  const item = await service.editarItem(req.params.id, data, req.auth!.usuarioId);
  return ok(res, item);
}

export async function cambiarMesaController(req: Request, res: Response) {
  const data = cambiarMesaSchema.parse(req.body);
  const orden = await service.cambiarMesaOrden(req.params.id, data);
  return ok(res, orden);
}

export async function listarProductosController(_req: Request, res: Response) {
  const productos = await service.listarProductos();
  return ok(res, productos);
}

export async function crearProductoController(req: Request, res: Response) {
  const data = crearProductoSchema.parse(req.body);
  const producto = await service.crearProducto(data);
  return created(res, producto);
}

export async function listarProductosAdminController(_req: Request, res: Response) {
  const productos = await service.listarProductosAdmin();
  return ok(res, productos);
}

export async function editarProductoController(req: Request, res: Response) {
  const data = editarProductoSchema.parse(req.body);
  const producto = await service.editarProducto(req.params.id, data);
  return ok(res, producto);
}

export async function subirImagenProductoController(req: Request, res: Response) {
  if (!req.file) throw Errors.badRequest("Falta el archivo de imagen");
  const imagenUrl = rutaPublicaImagen("productos", req.file.filename);
  const producto = await service.actualizarImagenProducto(req.params.id, imagenUrl);
  return ok(res, producto);
}

export async function obtenerDetalleOrdenController(req: Request, res: Response) {
  const detalle = await service.obtenerDetalleOrden(req.params.id);
  return ok(res, detalle);
}

export async function cerrarOrdenController(req: Request, res: Response) {
  const data = cerrarOrdenSchema.parse(req.body);
  const resultado = await service.cerrarOrden(req.params.id, data, req.auth!.usuarioId, req.auth!.rolId);
  return ok(res, resultado);
}

export async function pagarItemsController(req: Request, res: Response) {
  const data = pagarItemsSchema.parse(req.body);
  const resultado = await service.pagarItems(req.params.id, data, req.auth!.usuarioId);
  return ok(res, resultado);
}

export async function iniciarCobroController(req: Request, res: Response) {
  const data = iniciarCobroSchema.parse(req.body);
  const cuenta = await service.iniciarCobro(req.params.id, data, req.auth!.usuarioId);
  return ok(res, cuenta);
}

export async function obtenerCuentaController(req: Request, res: Response) {
  const cuenta = await service.obtenerCuenta(req.params.id);
  return ok(res, cuenta);
}

export async function registrarAbonoController(req: Request, res: Response) {
  const data = registrarAbonoSchema.parse(req.body);
  const cuenta = await service.registrarAbono(req.params.parteId, data, req.auth!.usuarioId);
  return ok(res, cuenta);
}

export async function cancelarOrdenController(req: Request, res: Response) {
  const orden = await service.cancelarOrden(req.params.id, req.auth!.usuarioId);
  return ok(res, orden);
}

export async function resetearOrdenesController(req: Request, res: Response) {
  resetearOrdenesSchema.parse(req.body);
  const resultado = await service.resetearOrdenes();
  return ok(res, resultado);
}

export async function reiniciarTodoController(req: Request, res: Response) {
  reiniciarTodoSchema.parse(req.body);
  const resultado = await service.reiniciarTodo();
  return ok(res, resultado);
}

export async function listarColaDeCocinaController(_req: Request, res: Response) {
  const items = await service.listarColaDeCocina();
  return ok(res, items);
}

export async function listarHistorialDespachadosController(_req: Request, res: Response) {
  const items = await service.listarHistorialDespachados();
  return ok(res, items);
}

export async function empezarPrepararController(req: Request, res: Response) {
  const items = await service.empezarPreparar(req.params.id, req.auth!.usuarioId);
  return ok(res, items);
}

export async function marcarCheckItemController(req: Request, res: Response) {
  const data = checkItemSchema.parse(req.body);
  const item = await service.marcarCheckItem(req.params.id, data);
  return ok(res, item);
}

export async function marcarOrdenListaController(req: Request, res: Response) {
  const resultado = await service.marcarOrdenLista(req.params.id, req.auth!.usuarioId);
  return ok(res, resultado);
}

export async function listarItemsActivosController(_req: Request, res: Response) {
  const items = await service.listarItemsActivos();
  return ok(res, items);
}

export async function entregarItemController(req: Request, res: Response) {
  const item = await service.entregarItem(req.params.id, req.auth!.usuarioId);
  return ok(res, item);
}

export async function obtenerFacturaOrdenController(req: Request, res: Response) {
  const factura = await service.obtenerFacturaOrden(req.params.id);
  return ok(res, factura);
}

// Reimprimir desde Caja General: ahí los movimientos guardan venta_id, no
// orden_id (ver migao.service.ts::obtenerFacturaVenta).
export async function obtenerFacturaVentaController(req: Request, res: Response) {
  const factura = await service.obtenerFacturaVenta(req.params.id);
  return ok(res, factura);
}

export async function crearCotizacionController(req: Request, res: Response) {
  const data = crearCotizacionSchema.parse(req.body);
  const cotizacion = await service.crearCotizacion(req.auth!.usuarioId, data);
  return created(res, cotizacion);
}

export async function listarCotizacionesController(_req: Request, res: Response) {
  const cotizaciones = await service.listarCotizaciones();
  return ok(res, cotizaciones);
}

export async function obtenerCotizacionController(req: Request, res: Response) {
  const cotizacion = await service.obtenerCotizacion(req.params.id);
  return ok(res, cotizacion);
}

export async function eliminarCotizacionController(req: Request, res: Response) {
  const resultado = await service.eliminarCotizacion(req.params.id);
  return ok(res, resultado);
}
