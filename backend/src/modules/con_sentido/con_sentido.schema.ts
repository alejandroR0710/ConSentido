import { z } from "zod";
import { referenciaBancoSchema } from "../../shared/utils/pago-mixto";

const itemVentaSchema = z
  .object({
    // Producto del inventario (elegido en el buscador). Sin él es un "Otro
    // producto" escrito a mano: se vende, pero no descuenta stock.
    productoId: z.string().uuid().optional(),
    producto: z.string().trim().min(1).max(255),
    descripcion: z.string().trim().max(500).optional(),
    categoria: z.string().trim().max(100).optional(),
    cantidad: z.number().positive(),
    precioUnitario: z.number().nonnegative(),
    // Obligatoria (lo valida el service, que conoce el stock) si la venta deja
    // el producto en negativo: por qué no cuadró el inventario.
    observacionInventario: z.string().trim().max(500).optional(),
  })
  // El stock es por unidades enteras (el del e-commerce también).
  .refine((item) => !item.productoId || Number.isInteger(item.cantidad), {
    message: "La cantidad de un producto del inventario debe ser un número entero",
    path: ["cantidad"],
  });

// "mixto" no es un método real en la base (ver shared/utils/pago-mixto.ts): es
// una comodidad de UI que se descompone en 1-2 movimientos ya puros al guardar.
export const registrarVentaSchema = z.union([
  z.object({
    items: z.array(itemVentaSchema).min(1, "Agrega al menos un producto"),
    monto: z.number().positive(),
    metodoPago: z.enum(["efectivo", "banco"]),
    ...referenciaBancoSchema,
  }),
  z
    .object({
      items: z.array(itemVentaSchema).min(1, "Agrega al menos un producto"),
      monto: z.number().positive(),
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      ...referenciaBancoSchema,
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

// Carrito de productos Con Sentido vinculado a una parte de cuenta dividida
// de Migao (ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md).
// Con productoId: producto real del catálogo — precio, descuento de stock y
// sincronía con la tienda en línea los resuelve el servidor (nunca confía en
// el precio del cliente, ver con_sentido.service.ts::vincularCarritoTienda).
// Sin productoId: línea de texto libre (pedido explícito) — sin control de
// inventario ni sincronía, el precio es el que escribe el cajero a mano.
const itemCarritoTiendaSchema = z
  .object({
    productoId: z.string().uuid().optional(),
    nombre: z.string().trim().max(255).optional(),
    cantidad: z.number().positive(),
    precioUnitario: z.number().nonnegative(),
    observacionInventario: z.string().trim().max(500).optional(),
  })
  .refine((item) => item.productoId || (item.nombre && item.nombre.trim().length > 0), {
    message: "Cada línea necesita un producto del catálogo o, si es texto libre, un nombre",
    path: ["nombre"],
  });

export const vincularCarritoTiendaSchema = z.object({
  items: z.array(itemCarritoTiendaSchema).min(1, "Agrega al menos un producto"),
  descuentoPorcentaje: z.number().min(0).max(100).optional(),
});
export type VincularCarritoTiendaInput = z.infer<typeof vincularCarritoTiendaSchema>;

// Puerta 2 (desde Con Sentido): además de los productos, hay que decir a
// qué orden/mesa se vincula — parteId solo es necesario si esa mesa ya
// tiene la cuenta dividida en 2+ partes (ver con_sentido.service.ts::vincularMesa).
export const vincularMesaSchema = z.object({
  ordenId: z.string().uuid(),
  parteId: z.string().uuid().optional(),
  items: z.array(itemCarritoTiendaSchema).min(1, "Agrega al menos un producto"),
  descuentoPorcentaje: z.number().min(0).max(100).optional(),
});
export type VincularMesaInput = z.infer<typeof vincularMesaSchema>;

// Administración del área (módulo) por defecto de una categoría de producto
// — ver con_sentido.repository.ts::listarCategoriasConArea/actualizarAreaCategoria.
export const actualizarAreaCategoriaSchema = z.object({
  areaSlug: z.enum(["insumos", "con_sentido"]),
});
export type ActualizarAreaCategoriaInput = z.infer<typeof actualizarAreaCategoriaSchema>;
