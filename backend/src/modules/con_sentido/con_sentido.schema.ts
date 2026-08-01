import { z } from "zod";

const itemVentaSchema = z.object({
  producto: z.string().trim().min(1).max(255),
  descripcion: z.string().trim().max(500).optional(),
  categoria: z.string().trim().max(100).optional(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
});

// "mixto" no es un método real en la base (ver shared/utils/pago-mixto.ts): es
// una comodidad de UI que se descompone en 1-2 movimientos ya puros al guardar.
export const registrarVentaSchema = z.union([
  z.object({
    items: z.array(itemVentaSchema).min(1, "Agrega al menos un producto"),
    monto: z.number().positive(),
    metodoPago: z.enum(["efectivo", "banco"]),
  }),
  z
    .object({
      items: z.array(itemVentaSchema).min(1, "Agrega al menos un producto"),
      monto: z.number().positive(),
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, {
      message: "El total del pago mixto debe ser mayor a 0",
      path: ["montoEfectivo"],
    }),
]);
export type RegistrarVentaInput = z.infer<typeof registrarVentaSchema>;

// Las imágenes llegan como data URI base64 desde el formulario — se limita el
// tamaño para no aceptar archivos absurdamente grandes en una columna TEXT.
const imagenUrlSchema = z.string().max(8_000_000).optional();

export const crearProductoConSentidoSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  precio: z.number().positive(),
  descripcion: z.string().trim().max(1000).optional(),
  categoria: z.string().trim().max(80).optional(),
  imagenUrl: imagenUrlSchema,
  stock: z.number().nonnegative().default(0),
});
export type CrearProductoConSentidoInput = z.infer<typeof crearProductoConSentidoSchema>;

export const editarProductoConSentidoSchema = z
  .object({
    nombre: z.string().trim().min(2).max(150).optional(),
    precio: z.number().positive().optional(),
    descripcion: z.string().trim().max(1000).optional(),
    categoria: z.string().trim().max(80).optional(),
    imagenUrl: imagenUrlSchema,
    stock: z.number().nonnegative().optional(),
    activo: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No hay ningún cambio para guardar" });
export type EditarProductoConSentidoInput = z.infer<typeof editarProductoConSentidoSchema>;

export const crearClienteConSentidoSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  telefono: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
});
export type CrearClienteConSentidoInput = z.infer<typeof crearClienteConSentidoSchema>;
