import { z } from "zod";

const METODOS_PAGO = ["efectivo", "banco"] as const;

export const abrirTurnoSchema = z.object({
  // Solo se usan si nunca se ha cerrado un turno antes (arranque del negocio);
  // si existe un cierre previo, sus montos se heredan automáticamente y esto se ignora.
  montoInicialEfectivo: z.number().nonnegative().optional(),
  montoInicialBanco: z.number().nonnegative().optional(),
});
export type AbrirTurnoInput = z.infer<typeof abrirTurnoSchema>;

export const cerrarTurnoSchema = z.object({
  // Conteo físico del efectivo al cerrar; banco no requiere conteo (es electrónico).
  montoFinalDeclaradoEfectivo: z.number().nonnegative(),
});
export type CerrarTurnoInput = z.infer<typeof cerrarTurnoSchema>;

export const registrarIngresoSchema = z.object({
  moduloOrigenSlug: z.enum(["insumos", "talleres", "con_sentido", "migao", "pedidos", "general"]),
  monto: z.number().positive(),
  metodoPago: z.enum(METODOS_PAGO),
  motivo: z.string().max(200).optional(),
  referenciaEntidad: z.string().max(80).optional(),
  referenciaId: z.string().max(64).optional(),
});
export type RegistrarIngresoInput = z.infer<typeof registrarIngresoSchema>;

export const registrarEgresoSchema = z.object({
  categoriaGastoId: z.number().int().positive(),
  monto: z.number().positive(),
  metodoPago: z.enum(METODOS_PAGO),
  motivo: z.string().max(200),
});
export type RegistrarEgresoInput = z.infer<typeof registrarEgresoSchema>;

export const crearCategoriaGastoSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
});
export type CrearCategoriaGastoInput = z.infer<typeof crearCategoriaGastoSchema>;

// Reset exclusivo de Super Root: exige escribir la frase exacta como segunda
// confirmación (además del permiso), para que no sea posible dispararlo por error.
export const resetearCajaSchema = z.object({
  confirmacion: z.literal("REINICIAR CAJA"),
});
export type ResetearCajaInput = z.infer<typeof resetearCajaSchema>;

export const historialCajaSchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
});
export type HistorialCajaInput = z.infer<typeof historialCajaSchema>;
