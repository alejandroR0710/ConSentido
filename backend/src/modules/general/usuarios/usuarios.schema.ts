import { z } from "zod";

export const crearUsuarioSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  rolId: z.number().int().positive(),
});
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

// Todo opcional, pero al menos un campo debe venir — igual que editarItemSchema
// en Migao, para no aceptar un PATCH vacío que no cambie nada.
export const editarUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(160).optional(),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").optional(),
    rolId: z.number().int().positive().optional(),
    activo: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No hay ningún cambio para guardar" });
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>;
