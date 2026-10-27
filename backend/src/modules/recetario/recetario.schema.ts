import { z } from "zod";

export const crearCategoriaSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la categoría").max(80),
});

// `.url()` de Zod solo exige que `new URL(...)` no reviente — acepta
// `javascript:`/`data:`/`mailto:` igual que `https:`. El `.refine` exige
// además que empiece por http(s), como pide la spec.
const videoUrlSchema = z
  .string()
  .trim()
  .url("El link de video no es una URL válida")
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), { message: "El link debe empezar con http:// o https://" });

export const crearRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta"),
  categoriaId: z.number().int().positive().optional(),
  videoUrl: videoUrlSchema.optional(),
});
export type CrearRecetaInput = z.infer<typeof crearRecetaSchema>;

// Todos opcionales (edición parcial). `.nullable()` en categoriaId/videoUrl
// deja distinguir "no tocar este campo" (omitido) de "vaciarlo" (null) —
// fijar videoUrl limpia la imagen principal en el repositorio (nunca
// coexisten), así que el frontend manda null acá cuando el cajero elige
// "Imagen" en vez de "Video" para el medio principal.
export const editarRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150).optional(),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta").optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  videoUrl: videoUrlSchema.nullable().optional(),
});
export type EditarRecetaInput = z.infer<typeof editarRecetaSchema>;

// Una receta puede tener varias presentaciones de emplatado (mismo plato,
// distinta forma de servirlo) — ver recetario_emplatados.
export const crearEmplatadoSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la presentación").max(150),
  guia: z.string().trim().optional(),
});
export type CrearEmplatadoInput = z.infer<typeof crearEmplatadoSchema>;

export const editarEmplatadoSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la presentación").max(150).optional(),
  guia: z.string().trim().nullable().optional(),
});
export type EditarEmplatadoInput = z.infer<typeof editarEmplatadoSchema>;
