import { z } from "zod";

export const crearProductoSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  precio: z.number().nonnegative(),
  costo: z.number().nonnegative().default(0),
  unidadMedida: z.string().trim().min(1).max(20).default("unidad"),
  categoriaId: z.number().int().positive().optional(),
  descripcion: z.string().trim().max(2000).optional(),
  // Cargo de "para llevar" (ej. envases): habilita que el Cajero pueda
  // agregarlo a una orden desde cobro (ver migao.ordenes.agregar_para_llevar).
  esParaLlevar: z.boolean().default(false),
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
  esParaLlevar: z.boolean().optional(),
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
  // 3 áreas por ahora: 1 = Salón 1, 2 = Salón 2, 3 = Jardín (ver frontend/areas.ts
  // para las etiquetas — acá solo se guarda el número, igual que antes).
  piso: z.number().int().min(1).max(3).default(1),
  items: z.array(agregarItemSchema).min(1, "Agrega al menos un producto antes de crear la orden"),
});
export type CrearOrdenInput = z.infer<typeof crearOrdenSchema>;

// "mixto" no es un método real en la base: es una comodidad de UI que se
// descompone en 1-2 líneas ya puras al cobrar (ver shared/utils/pago-mixto.ts).
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";
// Cada parte se arma por UNIDADES de producto, no por ítem completo: un ítem
// con cantidad 2 (ej. "2x Americano") puede repartirse 1 unidad a cada
// persona. El backend valida que la suma de cantidades asignadas a un mismo
// itemId, entre todas las partes, sea exactamente igual a su cantidad real.
// z.coerce: orden_items.id es BIGSERIAL, que node-postgres devuelve como
// string — el frontend lo reenvía tal cual lo recibió, número o string.
const unidadesSchema = z
  .array(
    z.object({
      itemId: z.coerce.number().int().positive(),
      cantidad: z.number().positive(),
    }),
  )
  .min(1, "Cada parte necesita al menos un producto");

// Descuento (%) y método "administrativo" solo existen en el cobro SIMPLE (no
// dividido): dividir ya reparte por unidades entre varias personas, y sumarle
// descuento/administrativo por parte agrega demasiados casos borde para lo
// que se pidió.
const descuentoSchema = { descuentoPorcentaje: z.number().min(0).max(100).optional() };

// Propina opcional (5%/10%/valor voluntario) sobre el valor de la cuenta —
// a diferencia de descuento/administrativo, SÍ existe en las 3 ramas
// (incluida la dividida): se calcula una sola vez sobre el total y se
// reparte entre las personas solo en pantalla (ver migao.service.ts —
// nunca se fragmenta en la base de datos, ni entra en la validación de
// mixto ni en cajaService.registrarIngreso, porque es dinero del mesero,
// no de Caja General).
const propinaSchema = {
  propina: z.number().nonnegative().optional(),
  // NULL/ausente = valor voluntario/personalizado (no un 5%/10% fijo) — solo
  // se guarda para mostrarlo bonito en el historial de propinas.
  propinaPorcentaje: z.number().nullable().optional(),
  // En qué método se recibió la propina (efectivo/banco) — determina de qué
  // "pendiente por repartir" descuenta (ver migao.service.ts::repartirPropinas).
  propinaMetodoPago: z.enum(["efectivo", "banco"]).optional(),
};

// Cobro normal (un solo método, o mixto efectivo+banco) o dividido (varias
// partes, cada una con sus propias unidades de producto y su propio método
// de pago, también simple o mixto) — ej. dos comensales que pidieron junto en
// una sola orden pero quieren pagar cada uno lo suyo.
export const cerrarOrdenSchema = z.union([
  z.object({
    dividir: z.literal(false),
    // "administrativo": exclusivo de Root/Super Root, validado en el service
    // (esta ruta también la usa el Cajero para cobrar normal, ver
    // migao.service.ts::cerrarOrden).
    metodoPago: z.enum(["efectivo", "banco", "administrativo"]),
    referencia: z.string().max(100).optional(),
    ...descuentoSchema,
    ...propinaSchema,
  }),
  z
    .object({
      dividir: z.literal(false),
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      referencia: z.string().max(100).optional(),
      ...descuentoSchema,
      ...propinaSchema,
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
  z.object({
    dividir: z.literal(true),
    partes: z
      .array(
        z.union([
          z.object({ metodoPago: z.enum(["efectivo", "banco"]), unidades: unidadesSchema }),
          z
            .object({
              metodoPago: z.literal("mixto"),
              montoEfectivo: z.number().nonnegative(),
              montoBanco: z.number().nonnegative(),
              unidades: unidadesSchema,
            })
            .refine((d) => d.montoEfectivo + d.montoBanco > 0, {
              message: MENSAJE_MIXTO_VACIO,
              path: ["montoEfectivo"],
            }),
        ]),
      )
      .min(2, "Divide la cuenta entre al menos 2 partes"),
    ...propinaSchema,
  }),
]);
export type CerrarOrdenInput = z.infer<typeof cerrarOrdenSchema>;

// Repartir las propinas pendientes de UN método (efectivo o banco) por
// separado — cada uno con su propia periodicidad, ver
// migao.service.ts::repartirPropinas.
export const repartirPropinasSchema = z.object({
  metodoPago: z.enum(["efectivo", "banco"]),
  nota: z.string().max(200).optional(),
});
export type RepartirPropinasInput = z.infer<typeof repartirPropinasSchema>;

// Reset exclusivo de Super Root: exige escribir la frase exacta como segunda
// confirmación (además del permiso), igual que el reset de Caja.
export const resetearOrdenesSchema = z.object({
  confirmacion: z.literal("REINICIAR ORDENES"),
});
export type ResetearOrdenesInput = z.infer<typeof resetearOrdenesSchema>;

// Reinicio total exclusivo de Super Root: frase distinta a la de arriba a
// propósito, para que no se pueda confundir con el reset parcial de órdenes.
export const reiniciarTodoSchema = z.object({
  confirmacion: z.literal("REINICIAR TODO"),
});
export type ReiniciarTodoInput = z.infer<typeof reiniciarTodoSchema>;

// El mesero cambia la mesa de una orden ya abierta (ej. los comensales se
// cambiaron de mesa). La mesa se resuelve/crea por número, igual que al crear la orden.
export const cambiarMesaSchema = z.object({
  mesaNumero: z.string().trim().min(1).max(10),
  // Antes tope en 2: no dejaba cambiar la mesa de una orden a Jardín (piso 3),
  // aunque crearOrdenSchema sí lo permitía desde el inicio.
  piso: z.number().int().min(1).max(3).default(1),
});
export type CambiarMesaInput = z.infer<typeof cambiarMesaSchema>;

// Plano visual de mesas por área (editor, exclusivo de Root/Super Root vía
// migao.mesas.administrar). Posición/tamaño en % (0-100) del lienzo de esa
// área, para que el layout sea responsive sin depender de un tamaño de
// pantalla fijo.
const coordenadaMesaSchema = z.number().min(0).max(100);
const tamanoMesaSchema = z.number().min(4).max(100);

export const crearMesaSchema = z
  .object({
    numero: z.string().trim().min(1).max(10),
    piso: z.number().int().min(1).max(3),
    capacidad: z.number().int().positive().max(50).default(4),
    posX: coordenadaMesaSchema,
    posY: coordenadaMesaSchema,
    ancho: tamanoMesaSchema,
    alto: tamanoMesaSchema,
  })
  .refine((d) => d.posX + d.ancho <= 100.01, { message: "La mesa se sale del plano horizontalmente", path: ["ancho"] })
  .refine((d) => d.posY + d.alto <= 100.01, { message: "La mesa se sale del plano verticalmente", path: ["alto"] });
export type CrearMesaInput = z.infer<typeof crearMesaSchema>;

export const posicionMesaSchema = z
  .object({
    posX: coordenadaMesaSchema,
    posY: coordenadaMesaSchema,
    ancho: tamanoMesaSchema,
    alto: tamanoMesaSchema,
  })
  .refine((d) => d.posX + d.ancho <= 100.01, { message: "La mesa se sale del plano horizontalmente", path: ["ancho"] })
  .refine((d) => d.posY + d.alto <= 100.01, { message: "La mesa se sale del plano verticalmente", path: ["alto"] });
export type PosicionMesaInput = z.infer<typeof posicionMesaSchema>;

// Renombrar/cambiar capacidad o área, y activar/desactivar ("eliminar" suave
// cuando ya tiene historial) — reactivar es el mismo endpoint con activo:true.
export const editarMesaSchema = z.object({
  numero: z.string().trim().min(1).max(10).optional(),
  piso: z.number().int().min(1).max(3).optional(),
  capacidad: z.number().int().positive().max(50).optional(),
  activo: z.boolean().optional(),
});
export type EditarMesaInput = z.infer<typeof editarMesaSchema>;

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
    // Permite corregir la nota del mesero (ej. "sin azúcar") sin necesidad de
    // tocar la cantidad — puede venir sola o junto con un cambio de cantidad.
    observaciones: z.string().trim().max(300).optional(),
  })
  .refine((data) => data.cantidad !== undefined || data.cancelar === true || data.observaciones !== undefined, {
    message: "Debes indicar una nueva cantidad, una observación, o cancelar el ítem",
  });
export type EditarItemInput = z.infer<typeof editarItemSchema>;
