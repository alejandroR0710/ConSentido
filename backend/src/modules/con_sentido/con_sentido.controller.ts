import { Request, Response } from "express";
import {
  registrarVentaService,
  listarVentasService,
  obtenerVentaService,
} from "./con_sentido.service";

export async function registrarVentaController(req: Request, res: Response) {
  const usuarioId = (req as any).user?.id || null;
  const venta = await registrarVentaService(usuarioId, req.body);
  res.status(201).json({ data: venta, error: null, meta: {} });
}

export async function listarVentasController(req: Request, res: Response) {
  const { skip = 0, limit = 50, fecha } = req.query;
  const ventas = await listarVentasService(
    parseInt(skip as string),
    parseInt(limit as string),
    fecha as string,
  );
  res.json({ data: ventas, error: null, meta: {} });
}

export async function obtenerVentaController(req: Request, res: Response) {
  const { id } = req.params;
  const venta = await obtenerVentaService(id);
  if (!venta) {
    res.status(404).json({ data: null, error: { code: "NOT_FOUND", message: "Venta no encontrada" }, meta: {} });
    return;
  }
  res.json({ data: venta, error: null, meta: {} });
}
