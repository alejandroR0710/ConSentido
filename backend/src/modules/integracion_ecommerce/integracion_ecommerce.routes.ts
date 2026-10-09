import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/utils/async-handler";
import { Errors } from "../../shared/utils/app-error";
import { configSincronizacion } from "./config";
import { aplicarEvento } from "./recepcion";
import { enviarPendientes, estadoSalida } from "./salida";
import type { EventoEntrante } from "./tipos";

// Rutas que llama el e-commerce (servidor a servidor) y un cron del hosting —
// sin sesión de usuario: secreto compartido en `x-sync-key`. Fail-closed: sin
// ECOMMERCE_SYNC_KEY configurada nadie entra.
function exigirClave(req: Request, _res: Response, next: NextFunction) {
  const esperada = configSincronizacion()?.clave;
  if (!esperada) return next(Errors.unauthorized("La sincronización con el e-commerce no está configurada."));
  const recibida = req.headers["x-sync-key"];
  const a = Buffer.from(typeof recibida === "string" ? recibida : "");
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return next(Errors.unauthorized("Clave de sincronización inválida."));
  }
  next();
}

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).nullable(),
  sku: z.string().min(1).max(191),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  salePrice: z.number().nonnegative().nullable(),
  // Precio mayorista neto y desde cuántas unidades (opcionales: un e-commerce viejo no los manda).
  wholesalePrice: z.number().nonnegative().nullable().optional(),
  wholesaleMinQty: z.number().int().min(2).nullable().optional(),
  wholesaleNote: z.string().max(120).nullable().optional(),
  stock: z.number().int(),
});

const eventoSchema = z.discriminatedUnion("type", [
  z.object({
    eventId: z.string().min(1).max(191),
    type: z.literal("PRODUCT_SNAPSHOT"),
    createdAt: z.string().optional(),
    payload: z.object({
      productId: z.string().min(1),
      name: z.string(),
      category: z.string().nullable(),
      imageUrl: z.string().nullable(),
      published: z.boolean(),
      deleted: z.boolean(),
      items: z.array(itemSchema),
      setStock: z.boolean(),
      emittedAt: z.string(),
    }),
  }),
  z.object({
    eventId: z.string().min(1).max(191),
    type: z.literal("STOCK_DELTA"),
    createdAt: z.string().optional(),
    payload: z.object({
      productId: z.string().min(1),
      variantId: z.string().min(1).nullable(),
      sku: z.string(),
      delta: z.number().int(),
      newStock: z.number().int(),
      movementType: z.string(),
      reason: z.string().nullable(),
      occurredAt: z.string(),
    }),
  }),
]);

export const integracionEcommerceRouter = Router();

integracionEcommerceRouter.use(exigirClave);

integracionEcommerceRouter.post(
  "/eventos",
  asyncHandler(async (req: Request, res: Response) => {
    const evento = eventoSchema.parse(req.body) as EventoEntrante;
    res.json(await aplicarEvento(evento));
  }),
);

// Para un cron del hosting (cada minuto): despierta la app y entrega lo pendiente.
integracionEcommerceRouter.post(
  "/flush",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ entregados: await enviarPendientes() });
  }),
);

integracionEcommerceRouter.get(
  "/estado",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await estadoSalida());
  }),
);
