import { Request, Response } from "express";
import * as amasijosService from "./amasijos.service";

export async function obtenerEstadoAmasijos(req: Request, res: Response) {
  const estado = await amasijosService.obtenerEstadoAmasijos();
  res.json({ data: estado, error: null, meta: {} });
}

export async function obtenerEstadoBasesPrepаradas(req: Request, res: Response) {
  const estado = await amasijosService.obtenerEstadoBasesPrepаradas();
  res.json({ data: estado, error: null, meta: {} });
}

export async function obtenerRecomendaciones(req: Request, res: Response) {
  const recomendaciones = await amasijosService.obtenerRecomendacionesPreparacion();
  res.json({ data: recomendaciones, error: null, meta: {} });
}

export async function registrarEntrada(req: Request, res: Response) {
  const { amasijoTipoId, cantidadCompleta = 0, cantidadMedia = 0, motivo } = req.body;
  const usuarioId = (req as any).user?.id || null;

  const resultado = await amasijosService.registrarEntradaAmasijo(
    amasijoTipoId,
    cantidadCompleta,
    cantidadMedia,
    motivo,
    usuarioId
  );

  res.status(201).json({ data: resultado, error: null, meta: {} });
}

export async function prepararBases(req: Request, res: Response) {
  const { baseTipoId, cantidad } = req.body;
  const usuarioId = (req as any).user?.id || null;

  const resultado = await amasijosService.prepararBases(baseTipoId, cantidad, usuarioId);

  res.status(201).json({ data: resultado, error: null, meta: {} });
}

export async function obtenerRecetas(req: Request, res: Response) {
  const recetas = await amasijosService.obtenerRecetas();
  res.json({ data: recetas, error: null, meta: {} });
}

export async function actualizarReceta(req: Request, res: Response) {
  const { id } = req.params;
  const { cantidadAmasijo } = req.body;
  const usuarioId = (req as any).user?.id || null;

  const resultado = await amasijosService.actualizarReceta(id, cantidadAmasijo, usuarioId);

  res.json({ data: resultado, error: null, meta: {} });
}
