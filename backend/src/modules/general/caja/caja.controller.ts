import { Request, Response } from "express";
import { created, ok } from "../../../shared/utils/response";
import {
  abrirTurnoSchema,
  agregarMovimientoHistoricoSchema,
  anularVentaSchema,
  borrarHistorialDiaSchema,
  borrarTurnoSchema,
  cerrarTurnoSchema,
  crearCategoriaGastoSchema,
  editarMetodoPagoMovimientoSchema,
  editarMovimientoHistoricoSchema,
  fechaParamSchema,
  historialCajaSchema,
  registrarEgresoAcumuladoSchema,
  registrarEgresoSchema,
  registrarIngresoSchema,
  resetearCajaSchema,
  turnosPorFechaSchema,
} from "./caja.schema";
import * as service from "./caja.service";

export async function obtenerTurnoAbiertoController(_req: Request, res: Response) {
  const turno = await service.obtenerTurnoAbierto();
  return ok(res, turno);
}

export async function abrirTurnoController(req: Request, res: Response) {
  const data = abrirTurnoSchema.parse(req.body ?? {});
  const turno = await service.abrirTurno(req.auth!.usuarioId, data);
  return created(res, turno);
}

export async function cerrarTurnoController(req: Request, res: Response) {
  const data = cerrarTurnoSchema.parse(req.body);
  const turno = await service.cerrarTurno(req.params.id, data);
  return ok(res, turno);
}

export async function obtenerResumenTurnoController(req: Request, res: Response) {
  const resumen = await service.obtenerResumenTurno(req.params.id);
  return ok(res, resumen);
}

export async function registrarIngresoController(req: Request, res: Response) {
  const data = registrarIngresoSchema.parse(req.body);
  const movimientos = await service.registrarIngreso(data, req.auth!.usuarioId);
  return created(res, movimientos);
}

export async function obtenerFacturaVentaManualController(req: Request, res: Response) {
  const factura = await service.obtenerFacturaVentaManual(req.params.id);
  return ok(res, factura);
}

export async function registrarEgresoController(req: Request, res: Response) {
  const data = registrarEgresoSchema.parse(req.body);
  const movimientos = await service.registrarEgreso(data, req.auth!.usuarioId);
  return created(res, movimientos);
}

export async function registrarEgresoAcumuladoController(req: Request, res: Response) {
  const data = registrarEgresoAcumuladoSchema.parse(req.body);
  const egreso = await service.registrarEgresoAcumulado(data, req.auth!.usuarioId);
  return created(res, egreso);
}

export async function obtenerAcumuladoTotalController(_req: Request, res: Response) {
  const acumulado = await service.obtenerAcumuladoTotal();
  return ok(res, acumulado);
}

export async function listarCategoriasGastoController(_req: Request, res: Response) {
  const categorias = await service.listarCategoriasGasto();
  return ok(res, categorias);
}

export async function crearCategoriaGastoController(req: Request, res: Response) {
  const { nombre, moduloOrigenSlug } = crearCategoriaGastoSchema.parse(req.body);
  const categoria = await service.crearCategoriaGasto(nombre, moduloOrigenSlug);
  return created(res, categoria);
}

export async function actualizarCategoriaGastoController(req: Request, res: Response) {
  const { nombre, moduloOrigenSlug } = crearCategoriaGastoSchema.parse(req.body);
  const categoria = await service.actualizarCategoriaGasto(Number(req.params.id), nombre, moduloOrigenSlug);
  return ok(res, categoria);
}

export async function editarMetodoPagoMovimientoController(req: Request, res: Response) {
  const data = editarMetodoPagoMovimientoSchema.parse(req.body);
  const movimientos = await service.editarMetodoPagoMovimiento(Number(req.params.id), data);
  return ok(res, movimientos);
}

export async function resetearCajaController(req: Request, res: Response) {
  resetearCajaSchema.parse(req.body);
  const resultado = await service.resetearCaja();
  return ok(res, resultado);
}

export async function obtenerHistorialCajaController(req: Request, res: Response) {
  const { anio } = historialCajaSchema.parse(req.query);
  const historial = await service.obtenerHistorialAnual(anio);
  return ok(res, historial);
}

export async function obtenerTurnosPorFechaController(req: Request, res: Response) {
  const { fecha } = turnosPorFechaSchema.parse(req.query);
  const turnos = await service.obtenerTurnosPorFecha(fecha);
  return ok(res, turnos);
}

export async function obtenerMovimientosDelDiaController(req: Request, res: Response) {
  const { fecha } = turnosPorFechaSchema.parse(req.query);
  const movimientos = await service.obtenerMovimientosDelDia(fecha);
  return ok(res, movimientos);
}

export async function borrarHistorialDiaController(req: Request, res: Response) {
  const data = borrarHistorialDiaSchema.parse(req.body);
  const resultado = await service.borrarHistorialDia(data.fecha);
  return ok(res, resultado);
}

export async function borrarTurnoController(req: Request, res: Response) {
  borrarTurnoSchema.parse(req.body);
  const resultado = await service.borrarTurno(req.params.id);
  return ok(res, resultado);
}

export async function agregarMovimientoHistoricoController(req: Request, res: Response) {
  const { fecha } = fechaParamSchema.parse(req.params);
  const data = agregarMovimientoHistoricoSchema.parse(req.body);
  const movimiento = await service.agregarMovimientoHistorico(fecha, data, req.auth!.usuarioId);
  return created(res, movimiento);
}

export async function editarMovimientoHistoricoController(req: Request, res: Response) {
  const data = editarMovimientoHistoricoSchema.parse(req.body);
  const movimiento = await service.editarMovimientoHistorico(Number(req.params.id), data, req.auth!.usuarioId);
  return ok(res, movimiento);
}

export async function listarEdicionesDelDiaController(req: Request, res: Response) {
  const { fecha } = fechaParamSchema.parse(req.params);
  const ediciones = await service.listarEdicionesDelDia(fecha);
  return ok(res, ediciones);
}

export async function anularVentaController(req: Request, res: Response) {
  const data = anularVentaSchema.parse(req.body);
  const resultado = await service.anularVenta(Number(req.params.id), data, req.auth!.usuarioId);
  return ok(res, resultado);
}

export async function listarProveedoresController(_req: Request, res: Response) {
  const proveedores = await service.listarProveedores();
  return ok(res, proveedores);
}

export async function crearProveedorController(req: Request, res: Response) {
  const { nombre, contacto, telefono, email } = req.body;
  const proveedor = await service.crearProveedor(nombre, contacto, telefono, email);
  return created(res, proveedor);
}

export async function actualizarProveedorController(req: Request, res: Response) {
  const { id } = req.params;
  const { nombre, contacto, telefono, email } = req.body;
  const proveedor = await service.actualizarProveedor(id, nombre, contacto, telefono, email);
  return ok(res, proveedor);
}

export async function desactivarProveedorController(req: Request, res: Response) {
  const { id } = req.params;
  const proveedor = await service.desactivarProveedor(id);
  return ok(res, proveedor);
}
