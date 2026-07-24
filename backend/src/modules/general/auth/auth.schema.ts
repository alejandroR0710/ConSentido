import { z } from "zod";

// Acepta indistintamente un correo o un número de documento — cada usuario
// tiene guardado uno u otro (nunca ambos, ver el CHECK en la tabla usuarios),
// así que basta con comparar este único valor contra las dos columnas.
export const loginSchema = z.object({
  identificador: z.string().trim().min(1, "Ingresa tu correo o número de documento"),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
