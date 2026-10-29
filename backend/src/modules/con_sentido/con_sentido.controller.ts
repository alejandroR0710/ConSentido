import { Request, Response } from "express";
import { created, ok } from "../../shared/utils/response";
import {
  actualizarAreaCategoriaSchema,
  crearClienteConSentidoSchema,
  crearProductoConSentidoSchema,
  editarProductoConSentidoSchema,
  registrarVentaSchema,
  vincularMesaSchema,
} from "./con_sentido.schema";
import * as service from "./con_sentido.service";

export async function listarProductosController(_req: Request, res: Response) {
  const productos = await service.listarProductos();
  return ok(res, productos);
}

export async function crearProductoController(req: Request, res: Response) {
  const data = crearProductoConSentidoSchema.parse(req.body);
  const producto = await service.crearProducto(data);
  return created(res, producto);
}

export async function editarProductoController(req: Request, res: Response) {
  const data = editarProductoConSentidoSchema.parse(req.body);
  const producto = await service.editarProducto(req.params.id, data);
  return ok(res, producto);
}

export async function listarClientesController(_req: Request, res: Response) {
  const clientes = await service.listarClientes();
  return ok(res, clientes);
}

export async function crearClienteController(req: Request, res: Response) {
  const data = crearClienteConSentidoSchema.parse(req.body);
  const cliente = await service.crearCliente(data);
  return created(res, cliente);
}

export async function registrarVentaController(req: Request, res: Response) {
  const data = registrarVentaSchema.parse(req.body);
  const venta = await service.registrarVenta(data, req.auth!.usuarioId);
  return created(res, venta);
}

export async function listarVentasController(req: Request, res: Response) {
  const { skip = "0", limit = "50", fecha } = req.query;
  const ventas = await service.listarVentas(parseInt(skip as string, 10), parseInt(limit as string, 10), fecha as string | undefined);
  return ok(res, ventas);
}

export async function obtenerVentaController(req: Request, res: Response) {
  const venta = await service.obtenerVenta(req.params.id);
  return ok(res, venta);
}

export async function obtenerFacturaVentaController(req: Request, res: Response) {
  const factura = await service.obtenerFacturaVenta(req.params.id);
  return ok(res, factura);
}

// Puerta 2 de la venta combinada mesa + Con Sentido — ver
// docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
export async function vincularMesaController(req: Request, res: Response) {
  const data = vincularMesaSchema.parse(req.body);
  const resultado = await service.vincularMesa(data, req.auth!.usuarioId);
  return created(res, resultado);
}

export async function listarCategoriasConAreaController(_req: Request, res: Response) {
  const categorias = await service.listarCategoriasConArea();
  return ok(res, categorias);
}

export async function actualizarAreaCategoriaController(req: Request, res: Response) {
  const data = actualizarAreaCategoriaSchema.parse(req.body);
  const categoria = await service.actualizarAreaCategoria(req.params.id, data);
  return ok(res, categoria);
}
