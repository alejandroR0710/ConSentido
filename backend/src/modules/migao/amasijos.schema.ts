import { z } from "zod";

export const registrarEntradaAmasijoSchema = z.object({
  amasijoTipoId: z.number().positive("ID de amasijo inválido"),
  cantidadCompleta: z.number().nonnegative().default(0),
  cantidadMedia: z.number().nonnegative().default(0),
  motivo: z.string().optional(),
});
export type RegistrarEntradaAmasijoInput = z.infer<typeof registrarEntradaAmasijoSchema>;

export const prepararBasesSchema = z.object({
  baseTipoId: z.number().positive("ID de base inválido"),
  cantidad: z.number().positive("La cantidad debe ser mayor a 0"),
});
export type PrepararBasesInput = z.infer<typeof prepararBasesSchema>;

export const actualizarRecetaSchema = z.object({
  cantidadAmasijo: z.number().positive("La cantidad debe ser mayor a 0"),
});
export type ActualizarRecetaInput = z.infer<typeof actualizarRecetaSchema>;
