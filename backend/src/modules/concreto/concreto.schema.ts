import { z } from "zod";

// La calculadora recibe SOLO el peso final de la pieza terminada (gramos);
// todo lo demás sale de la fórmula fija + los parámetros configurables.
export const calcularConcretoSchema = z.object({
  pesoFinalG: z.number().positive("El peso final debe ser mayor a 0"),
});
export type CalcularConcretoInput = z.infer<typeof calcularConcretoSchema>;

// Precios de material, costos fijos por pieza, mano de obra, multiplicador de
// venta y redondeo — lo único editable. La receta de fabricación (40% cemento
// / 60% marmolina / 24% agua y el factor de conversión) NO se toca, va fija
// en concreto.service.ts.
export const actualizarParametrosConcretoSchema = z.object({
  precioCementoGramo: z.number().positive(),
  precioMarmolinaGramo: z.number().positive(),
  costoAgua: z.number().nonnegative(),
  costoPintura: z.number().nonnegative(),
  costoSellante: z.number().nonnegative(),
  costoLija: z.number().nonnegative(),
  costoManoObra: z.number().nonnegative(),
  multiplicadorPrecio: z.number().positive(),
  redondeo: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]),
});
export type ActualizarParametrosConcretoInput = z.infer<typeof actualizarParametrosConcretoSchema>;
