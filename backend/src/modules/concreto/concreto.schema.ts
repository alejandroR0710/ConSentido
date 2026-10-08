import { z } from "zod";

// La calculadora recibe el peso final de la pieza terminada (gramos). Los
// demás campos son overrides opcionales: la pantalla única los manda mientras
// el usuario edita los precios/costos SIN haberlos guardado todavía, para ver
// el precio en vivo. Si no vienen, se usan los guardados en concreto_parametros.
export const calcularConcretoSchema = z.object({
  pesoFinalG: z.number().positive("El peso final debe ser mayor a 0"),
  precioCementoGramo: z.number().positive().optional(),
  precioMarmolinaGramo: z.number().positive().optional(),
  costoAgua: z.number().nonnegative().optional(),
  costoPintura: z.number().nonnegative().optional(),
  costoSellante: z.number().nonnegative().optional(),
  costoLija: z.number().nonnegative().optional(),
  costoVinipel: z.number().nonnegative().optional(),
  costoManoObra: z.number().nonnegative().optional(),
  multiplicadorPrecio: z.number().positive().optional(),
  redondeo: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]).optional(),
  // Empaques de la pieza (caja, cinta, etc.) — a diferencia de los demás
  // campos, nunca se guarda como default: cada pieza lleva lo que le toque.
  // Se suma directo al precio de venta ya calculado, sin multiplicador (ver
  // concreto.service.ts) — mismo criterio que el empaque en la calculadora
  // de velas.
  costoEmpaques: z.number().nonnegative().optional(),
});
export type CalcularConcretoInput = z.infer<typeof calcularConcretoSchema>;

// Precios de material, costos fijos por pieza, mano de obra, multiplicador de
// venta y redondeo — lo único editable. La receta de fabricación (40% cemento
// / 60% marmolina directo sobre el peso final) NO se toca, va fija en
// concreto.service.ts.
export const actualizarParametrosConcretoSchema = z.object({
  precioCementoGramo: z.number().positive(),
  precioMarmolinaGramo: z.number().positive(),
  costoAgua: z.number().nonnegative(),
  costoPintura: z.number().nonnegative(),
  costoSellante: z.number().nonnegative(),
  costoLija: z.number().nonnegative(),
  costoVinipel: z.number().nonnegative(),
  costoManoObra: z.number().nonnegative(),
  multiplicadorPrecio: z.number().positive(),
  redondeo: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]),
});
export type ActualizarParametrosConcretoInput = z.infer<typeof actualizarParametrosConcretoSchema>;
