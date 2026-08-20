import { z } from "zod";

export const crearInventarioProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  categoriaId: z.number().int().positive().optional(),
  unidadMedida: z.string().trim().min(1).max(30),
  unidadesPorPaquete: z.number().positive().default(1),
  tamanoUnidad: z.string().trim().max(30).optional(),
  costoPaquete: z.number().nonnegative().optional(),
  stockMinimoUnidades: z.number().nonnegative().optional(),
});
export type CrearInventarioProductoInput = z.infer<typeof crearInventarioProductoSchema>;

export const editarInventarioProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  categoriaId: z.number().int().positive().optional(),
  unidadMedida: z.string().trim().min(1).max(30).optional(),
  unidadesPorPaquete: z.number().positive().optional(),
  tamanoUnidad: z.string().trim().max(30).optional(),
  costoPaquete: z.number().nonnegative().optional(),
  stockMinimoUnidades: z.number().nonnegative().optional(),
  activo: z.boolean().optional(),
});
export type EditarInventarioProductoInput = z.infer<typeof editarInventarioProductoSchema>;

export const crearCategoriaInventarioSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
});
export type CrearCategoriaInventarioInput = z.infer<typeof crearCategoriaInventarioSchema>;

// 'entrada' llega en paquetes (así lo entrega el proveedor) y se convierte a
// unidades en el service; 'ajuste' ya viene en unidades directas y puede ser
// negativo (corrige un conteo). 'consumo' nunca se acepta acá — lo escribe
// únicamente el flujo de órdenes (ver migao.service.ts).
export const registrarMovimientoInventarioSchema = z.union([
  z.object({
    tipo: z.literal("entrada"),
    productoId: z.string().uuid(),
    paquetes: z.number().positive(),
    motivo: z.string().max(200).optional(),
  }),
  z.object({
    tipo: z.literal("ajuste"),
    productoId: z.string().uuid(),
    unidades: z.number().refine((n) => n !== 0, "El ajuste no puede ser 0"),
    motivo: z.string().trim().min(3).max(200),
  }),
]);
export type RegistrarMovimientoInventarioInput = z.infer<typeof registrarMovimientoInventarioSchema>;

const ingredienteSchema = z.object({
  inventarioProductoId: z.string().uuid(),
  cantidadPorUnidad: z.number().positive(),
});
export type IngredienteInput = z.infer<typeof ingredienteSchema>;

export const guardarIngredientesSchema = z.object({
  ingredientes: z.array(ingredienteSchema),
});
export type GuardarIngredientesInput = z.infer<typeof guardarIngredientesSchema>;
