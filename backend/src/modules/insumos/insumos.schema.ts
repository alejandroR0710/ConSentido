import { z } from "zod";

export const crearInsumoSchema = z.object({
  nombre: z.string().min(2).max(150),
  categoriaId: z.number().int().positive().optional(),
  unidadMedida: z.string().min(1).max(20),
  stockMinimo: z.number().nonnegative().default(0),
  costoUnitario: z.number().nonnegative().default(0),
  proveedorPrincipalId: z.string().uuid().optional(),
  descripcion: z.string().trim().max(2000).optional(),
});
export type CrearInsumoInput = z.infer<typeof crearInsumoSchema>;

export const actualizarInsumoSchema = crearInsumoSchema.partial().extend({
  activo: z.boolean().optional(),
});
export type ActualizarInsumoInput = z.infer<typeof actualizarInsumoSchema>;

export const registrarMovimientoSchema = z.object({
  insumoId: z.string().uuid(),
  almacenId: z.number().int().positive(),
  tipo: z.enum(["entrada", "salida", "transferencia", "ajuste"]),
  cantidad: z.number().positive(),
  costoUnitario: z.number().nonnegative().optional(),
  motivo: z.string().max(150).optional(),
  almacenDestinoId: z.number().int().positive().optional(),
  proveedorId: z.string().uuid().optional(),
}).refine((data) => data.tipo !== "transferencia" || data.almacenDestinoId !== undefined, {
  message: "almacenDestinoId es requerido para movimientos de tipo transferencia",
  path: ["almacenDestinoId"],
});
export type RegistrarMovimientoInput = z.infer<typeof registrarMovimientoSchema>;
