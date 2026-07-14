import { z } from "zod";

export const crearProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  precio: z.number().nonnegative(),
  costo: z.number().nonnegative().default(0),
  unidadMedida: z.string().trim().min(1).max(20).default("unidad"),
  categoriaId: z.number().int().positive().optional(),
  descripcion: z.string().trim().max(2000).optional(),
});
export type CrearProductoInput = z.infer<typeof crearProductoSchema>;

// Editar un producto: nombre/precio/costo/unidad/categoría/descripción, o
// desactivarlo ("eliminar" del menú sin borrarlo físicamente — puede estar
// referenciado por órdenes/ventas ya cerradas). Reactivar es el mismo endpoint
// con activo:true.
export const editarProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(150).optional(),
  precio: z.number().nonnegative().optional(),
  costo: z.number().nonnegative().optional(),
  unidadMedida: z.string().trim().min(1).max(20).optional(),
  categoriaId: z.number().int().positive().optional(),
  descripcion: z.string().trim().max(2000).optional(),
  activo: z.boolean().optional(),
});
export type EditarProductoInput = z.infer<typeof editarProductoSchema>;

export const crearCategoriaProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
});
export type CrearCategoriaProductoInput = z.infer<typeof crearCategoriaProductoSchema>;

export const agregarItemSchema = z.object({
  productoId: z.string().uuid(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
  // Nota del mesero (ej. "sin azúcar"): solo visible para Cocina al empezar a preparar.
  observaciones: z.string().trim().max(300).optional(),
});
export type AgregarItemInput = z.infer<typeof agregarItemSchema>;

// El mesero arma todo el pedido antes de crear nada: mesa + productos se envían
// juntos, y recién ahí se crea la orden con sus ítems (una sola transacción).
// La mesa se resuelve/crea por número y el comensal_numero lo asigna la BD sola.
export const crearOrdenSchema = z.object({
  mesaNumero: z.string().trim().min(1).max(10),
  clienteId: z.string().uuid().optional(),
  numeroPersonas: z.number().int().positive().max(999).optional(),
  // Solo existen 2 pisos por ahora; por defecto 1, el mesero lo ajusta si la mesa está en el 2.
  piso: z.number().int().min(1).max(2).default(1),
  items: z.array(agregarItemSchema).min(1, "Agrega al menos un producto antes de crear la orden"),
});
export type CrearOrdenInput = z.infer<typeof crearOrdenSchema>;

// "mixto" no es un método real en la base: es una comodidad de UI que se
// descompone en 1-2 líneas ya puras al cobrar (ver shared/utils/pago-mixto.ts).
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";
// z.coerce: orden_items.id es BIGSERIAL, que node-postgres devuelve como
// string — el frontend lo reenvía tal cual lo recibió, número o string.
const itemIdsSchema = z.array(z.coerce.number().int().positive()).min(1, "Cada parte necesita al menos un producto");

// Cobro normal (un solo método, o mixto efectivo+banco) o dividido (varias
// partes, cada una con sus propios productos y su propio método de pago,
// también simple o mixto) — ej. dos comensales que pidieron junto en una sola
// orden pero quieren pagar cada uno lo suyo.
export const cerrarOrdenSchema = z.union([
  z.object({
    dividir: z.literal(false),
    metodoPago: z.enum(["efectivo", "banco"]),
    referencia: z.string().max(100).optional(),
  }),
  z
    .object({
      dividir: z.literal(false),
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      referencia: z.string().max(100).optional(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
  z.object({
    dividir: z.literal(true),
    partes: z
      .array(
        z.union([
          z.object({ metodoPago: z.enum(["efectivo", "banco"]), itemIds: itemIdsSchema }),
          z
            .object({
              metodoPago: z.literal("mixto"),
              montoEfectivo: z.number().nonnegative(),
              montoBanco: z.number().nonnegative(),
              itemIds: itemIdsSchema,
            })
            .refine((d) => d.montoEfectivo + d.montoBanco > 0, {
              message: MENSAJE_MIXTO_VACIO,
              path: ["montoEfectivo"],
            }),
        ]),
      )
      .min(2, "Divide la cuenta entre al menos 2 partes"),
  }),
]);
export type CerrarOrdenInput = z.infer<typeof cerrarOrdenSchema>;

// Reset exclusivo de Super Root: exige escribir la frase exacta como segunda
// confirmación (además del permiso), igual que el reset de Caja.
export const resetearOrdenesSchema = z.object({
  confirmacion: z.literal("REINICIAR ORDENES"),
});
export type ResetearOrdenesInput = z.infer<typeof resetearOrdenesSchema>;

// Cocina marca/desmarca el check de un producto individual mientras la orden
// está en preparación. No cambia el estado del ítem, solo el check.
export const checkItemSchema = z.object({
  listoCocina: z.boolean(),
});
export type CheckItemInput = z.infer<typeof checkItemSchema>;

// El mesero corrige un ítem: nueva cantidad, o cancelarlo. Cualquiera de los dos,
// nunca ninguno.
export const editarItemSchema = z
  .object({
    cantidad: z.number().positive().optional(),
    cancelar: z.boolean().optional(),
  })
  .refine((data) => data.cantidad !== undefined || data.cancelar === true, {
    message: "Debes indicar una nueva cantidad o cancelar el ítem",
  });
export type EditarItemInput = z.infer<typeof editarItemSchema>;
