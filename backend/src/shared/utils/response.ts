import { Response } from "express";

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.json({ data, error: null, meta: meta ?? null });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ data, error: null, meta: null });
}
