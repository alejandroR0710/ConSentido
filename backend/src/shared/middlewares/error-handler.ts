import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../utils/app-error";

// Mensajes por código de MulterError — ver
// https://github.com/expressjs/multer#error-handling. Sin este mapeo, una
// foto de más de 5MB (muy común desde un celular) terminaba cayendo en el
// 500 genérico de abajo en vez de un 400 claro, en cualquier endpoint que
// suba imágenes (ver crearUploaderImagen en upload.middleware.ts).
const MENSAJES_MULTER: Record<string, string> = {
  LIMIT_FILE_SIZE: "La imagen es demasiado pesada (máximo 5MB).",
  LIMIT_UNEXPECTED_FILE: "No se esperaba ese archivo.",
};

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

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      data: null,
      error: { code: err.code, message: MENSAJES_MULTER[err.code] ?? "No se pudo subir el archivo." },
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
