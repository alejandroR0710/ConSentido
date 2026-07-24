import { z } from "zod";

function identificadorValido(tipo: "email" | "documento", valor: string) {
  if (tipo === "email") return z.string().email().safeParse(valor).success;
  return valor.trim().length >= 3;
}

// Cada usuario inicia sesión con correo O número de documento, nunca ambos
// (ver el CHECK en la tabla usuarios) — quien crea la cuenta elige cuál de
// los dos usar.
export const crearUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    rolId: z.number().int().positive(),
    tipoIdentificador: z.enum(["email", "documento"]),
    identificador: z.string().trim().min(1).max(160),
  })
  .superRefine((data, ctx) => {
    if (!identificadorValido(data.tipoIdentificador, data.identificador)) {
      ctx.addIssue({
        code: "custom",
        path: ["identificador"],
        message: data.tipoIdentificador === "email" ? "Correo inválido" : "Número de documento inválido (mínimo 3 caracteres)",
      });
    }
  });
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

// Todo opcional, pero al menos un campo debe venir; si se cambia el
// identificador, tipo y valor viajan juntos (cambiar uno sin el otro no tiene
// sentido: define cuál columna se llena y cuál se limpia).
export const editarUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120).optional(),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").optional(),
    rolId: z.number().int().positive().optional(),
    activo: z.boolean().optional(),
    tipoIdentificador: z.enum(["email", "documento"]).optional(),
    identificador: z.string().trim().min(1).max(160).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No hay ningún cambio para guardar" })
  .refine((data) => (data.tipoIdentificador === undefined) === (data.identificador === undefined), {
    message: "Debes indicar el tipo y el valor del identificador juntos",
    path: ["identificador"],
  })
  .superRefine((data, ctx) => {
    if (data.tipoIdentificador && data.identificador && !identificadorValido(data.tipoIdentificador, data.identificador)) {
      ctx.addIssue({
        code: "custom",
        path: ["identificador"],
        message: data.tipoIdentificador === "email" ? "Correo inválido" : "Número de documento inválido (mínimo 3 caracteres)",
      });
    }
  });
export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>;
