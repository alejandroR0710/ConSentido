import { z } from "zod";

const METODOS_PAGO = ["efectivo", "banco"] as const;

export const abrirTurnoSchema = z.object({
  // Solo se usan si nunca se ha cerrado un turno antes (arranque del negocio);
  // si existe un cierre previo, sus montos se heredan automáticamente y esto se ignora.
  montoInicialEfectivo: z.number().nonnegative().optional(),
  montoInicialBanco: z.number().nonnegative().optional(),
});
export type AbrirTurnoInput = z.infer<typeof abrirTurnoSchema>;

export const cerrarTurnoSchema = z.object({
  // Conteo físico del efectivo al cerrar; banco no requiere conteo (es electrónico).
  montoFinalDeclaradoEfectivo: z.number().nonnegative(),
});
export type CerrarTurnoInput = z.infer<typeof cerrarTurnoSchema>;

// "mixto" no es un método real en la base (ver shared/utils/pago-mixto.ts): es
// una comodidad de UI que se descompone en 1-2 movimientos ya puros al guardar.
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";

const camposIngreso = {
  moduloOrigenSlug: z.enum(["insumos", "talleres", "con_sentido", "migao", "pedidos", "general"]),
  motivo: z.string().max(200).optional(),
  referenciaEntidad: z.string().max(80).optional(),
  referenciaId: z.string().max(64).optional(),
};
export const registrarIngresoSchema = z.union([
  z.object({ ...camposIngreso, metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive() }),
  z
    .object({
      ...camposIngreso,
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type RegistrarIngresoInput = z.infer<typeof registrarIngresoSchema>;

const camposEgreso = {
  categoriaGastoId: z.number().int().positive(),
  motivo: z.string().max(200),
};
export const registrarEgresoSchema = z.union([
  z.object({ ...camposEgreso, metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive() }),
  z
    .object({
      ...camposEgreso,
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type RegistrarEgresoInput = z.infer<typeof registrarEgresoSchema>;

export const crearCategoriaGastoSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
});
export type CrearCategoriaGastoInput = z.infer<typeof crearCategoriaGastoSchema>;

// Reset exclusivo de Super Root: exige escribir la frase exacta como segunda
// confirmación (además del permiso), para que no sea posible dispararlo por error.
export const resetearCajaSchema = z.object({
  confirmacion: z.literal("REINICIAR CAJA"),
});
export type ResetearCajaInput = z.infer<typeof resetearCajaSchema>;

// Corrección de método: simple (efectivo<->banco) o a mixto, repartiendo el
// mismo monto original del movimiento entre los dos métodos (eso lo valida
// el service contra el monto ya existente, no aquí).
export const editarMetodoPagoMovimientoSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO) }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type EditarMetodoPagoMovimientoInput = z.infer<typeof editarMetodoPagoMovimientoSchema>;

export const historialCajaSchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
});
export type HistorialCajaInput = z.infer<typeof historialCajaSchema>;
