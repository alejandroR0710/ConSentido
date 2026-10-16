import { z } from "zod";

export const crearCategoriaSchema = z.object({
  nombre: z.string().trim().min(1, "Escribe el nombre de la categoría").max(80),
});

export const crearRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta"),
  categoriaId: z.number().int().positive().optional(),
  videoUrl: z.string().trim().url("El link de video no es una URL válida").max(500).optional(),
  descripcionEmplatado: z.string().trim().max(500).optional(),
});
export type CrearRecetaInput = z.infer<typeof crearRecetaSchema>;

// Todos opcionales (edición parcial). `.nullable()` en categoriaId/videoUrl/
// descripcionEmplatado deja distinguir "no tocar este campo" (omitido) de
// "vaciarlo" (null) — fijar videoUrl limpia la imagen principal en el
// repositorio (nunca coexisten), así que el frontend manda null acá cuando
// el cajero elige "Imagen" en vez de "Video" para el medio principal.
export const editarRecetaSchema = z.object({
  titulo: z.string().trim().min(1, "Escribe el título de la receta").max(150).optional(),
  instrucciones: z.string().trim().min(1, "Escribe las instrucciones de la receta").optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  videoUrl: z.string().trim().url("El link de video no es una URL válida").max(500).nullable().optional(),
  descripcionEmplatado: z.string().trim().max(500).nullable().optional(),
});
export type EditarRecetaInput = z.infer<typeof editarRecetaSchema>;
