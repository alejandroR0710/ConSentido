import { z } from "zod";

// Prepara N bases: consume amasijos según la receta de esa base (ambos son
// productos normales de migao_inventario_productos) y da entrada a la base.
export const prepararBaseSchema = z.object({
  baseProductoId: z.string().uuid(),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});
export type PrepararBaseInput = z.infer<typeof prepararBaseSchema>;

// Agrega una línea nueva a la receta de una base (qué amasijo y cuánto).
export const crearRecetaLineaSchema = z.object({
  baseProductoId: z.string().uuid(),
  amasijoProductoId: z.string().uuid(),
  cantidadAmasijo: z.number().positive("La cantidad debe ser mayor a 0"),
});
export type CrearRecetaLineaInput = z.infer<typeof crearRecetaLineaSchema>;

export const actualizarRecetaLineaSchema = z.object({
  cantidadAmasijo: z.number().positive("La cantidad debe ser mayor a 0"),
});
export type ActualizarRecetaLineaInput = z.infer<typeof actualizarRecetaLineaSchema>;
