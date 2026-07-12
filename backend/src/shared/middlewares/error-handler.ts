import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      data: null,
      error: { code: err.code, message: err.message },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      data: null,
      error: { code: "VALIDATION_ERROR", message: err.issues.map((i) => i.message).join(", ") },
    });
  }

  console.error(err);
  return res.status(500).json({
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ data: null, error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
}
