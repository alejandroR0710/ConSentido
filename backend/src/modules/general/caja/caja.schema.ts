import { z } from "zod";

const METODOS_PAGO = ["efectivo", "banco"] as const;
const MODULO_ORIGEN_VALUES = ["insumos", "talleres", "con_sentido", "migao", "pedidos", "general"] as const;

export const abrirTurnoSchema = z.object({
  // Base declarada a mano por el cajero para el turno del día — no se hereda
  // nada del cierre anterior, cada turno arranca con lo que se escriba aquí.
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

// Ítems libres opcionales (modo "Agregar productos" del ingreso manual desde
// Caja General) — cuando vienen, la factura que se genera los muestra
// desglosados; si no vienen, la factura lleva una sola línea con el motivo.
const itemIngresoSchema = z.object({
  nombre: z.string().trim().min(1).max(150),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
});

const camposIngreso = {
  moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES),
  motivo: z.string().max(200).optional(),
  referenciaEntidad: z.string().max(80).optional(),
  referenciaId: z.string().max(64).optional(),
  // Descuento (%) opcional sobre el monto bruto: lo que realmente se registra
  // (y se suma al turno) ya es el monto neto — ver caja.service.ts::registrarIngreso.
  descuentoPorcentaje: z.number().min(0).max(100).optional(),
  items: z.array(itemIngresoSchema).optional(),
  // Nunca lo manda el formulario de "Registrar ingreso" (ahí se autodetecta
  // por metodoPago:"mixto" con las 2 partes > 0, ver insertarMovimientosIngreso)
  // — solo lo pasan las llamadas internas de Migao (cerrarOrden/pagarItems/
  // registrarAbono), que ya le mandan cada línea con su método puro y por eso
  // necesitan decir aparte que ese pago, en conjunto, sí fue mixto.
  esPagoMixto: z.boolean().optional(),
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
  proveedorId: z.string().uuid().optional(),
  // A diferencia del ingreso (obligatorio), el área de un egreso es opcional:
  // muchos gastos (arriendo, nómina, servicios) no son de un área puntual —
  // ver analytics.repository.ts::getMovimientosPorModulo, que ya sabía
  // agrupar egresos por módulo pero nunca se le daba la oportunidad de
  // guardarlo desde el formulario normal de "Registrar egreso".
  moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
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

// Egreso contra el ACUMULADO TOTAL histórico (no un turno ni un día) — sin
// "mixto": es una reducción puntual de un solo método por vez, no hace
// falta descomponerlo (ver caja.service.ts::registrarEgresoAcumulado).
export const registrarEgresoAcumuladoSchema = z.object({
  ...camposEgreso,
  metodoPago: z.enum(["efectivo", "banco"]),
  monto: z.number().positive(),
});
export type RegistrarEgresoAcumuladoInput = z.infer<typeof registrarEgresoAcumuladoSchema>;

export const crearCategoriaGastoSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  // Área por defecto de esta categoría (opcional) — todo egreso que caiga
  // acá cuenta para esa área en el Dashboard, a menos que el egreso mismo
  // traiga su propio moduloOrigenSlug (ver camposEgreso).
  moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
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
// el service contra el monto ya existente, no aquí). `moduloOrigenSlug` es
// independiente del método — corrige de qué área viene el ingreso (ej. se
// registró como "Migao" pero era de "Con Sentido"); el service la rechaza si
// el movimiento no es un ingreso (los egresos no tienen área, tienen categoría).
export const editarMetodoPagoMovimientoSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO), moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional() }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type EditarMetodoPagoMovimientoInput = z.infer<typeof editarMetodoPagoMovimientoSchema>;

export const historialCajaSchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
});
export type HistorialCajaInput = z.infer<typeof historialCajaSchema>;

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const turnosPorFechaSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
});
export type TurnosPorFechaInput = z.infer<typeof turnosPorFechaSchema>;

// Borrados exclusivos de Super Root: exigen escribir la frase exacta como
// segunda confirmación, igual que el resto de acciones destructivas de Caja.
export const borrarHistorialDiaSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  confirmacion: z.literal("BORRAR HISTORIAL DEL DIA"),
});
export type BorrarHistorialDiaInput = z.infer<typeof borrarHistorialDiaSchema>;

export const borrarTurnoSchema = z.object({
  confirmacion: z.literal("BORRAR TURNO"),
});
export type BorrarTurnoInput = z.infer<typeof borrarTurnoSchema>;

// Ajustar el historial de un día YA cerrado (agregar un movimiento olvidado,
// o corregir uno existente) reabre contabilidad ya contada físicamente —
// misma frase de confirmación escrita que el resto de acciones sensibles de
// Caja, más una nota obligatoria explicando el porqué (queda en la auditoría).
const camposAjusteHistorico = {
  nota: z.string().trim().min(3).max(300),
  confirmacion: z.literal("AJUSTAR HISTORIAL"),
};

export const agregarMovimientoHistoricoSchema = z.union([
  z.object({
    ...camposAjusteHistorico,
    tipo: z.literal("ingreso"),
    moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES),
    monto: z.number().positive(),
    metodoPago: z.enum(METODOS_PAGO),
    motivo: z.string().max(200).optional(),
  }),
  z.object({
    ...camposAjusteHistorico,
    tipo: z.literal("egreso"),
    categoriaGastoId: z.number().int().positive(),
    proveedorId: z.string().uuid().optional(),
    // Igual que en el egreso normal (ver camposEgreso): opcional, no todo
    // gasto es de un área puntual.
    moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
    monto: z.number().positive(),
    metodoPago: z.enum(METODOS_PAGO),
    motivo: z.string().max(200),
  }),
]);
export type AgregarMovimientoHistoricoInput = z.infer<typeof agregarMovimientoHistoricoSchema>;

export const editarMovimientoHistoricoSchema = z
  .object({
    ...camposAjusteHistorico,
    monto: z.number().positive().optional(),
    metodoPago: z.enum(METODOS_PAGO).optional(),
    motivo: z.string().max(200).optional(),
    moduloOrigenSlug: z.enum(MODULO_ORIGEN_VALUES).optional(),
    categoriaGastoId: z.number().int().positive().optional(),
    proveedorId: z.string().uuid().optional(),
  })
  .refine((d) => d.monto !== undefined || d.metodoPago !== undefined || d.motivo !== undefined
    || d.moduloOrigenSlug !== undefined || d.categoriaGastoId !== undefined || d.proveedorId !== undefined, {
    message: "Debes cambiar al menos un campo",
  });
export type EditarMovimientoHistoricoInput = z.infer<typeof editarMovimientoHistoricoSchema>;

// Anular una venta (Migao o Con Sentido) desde cualquier día del historial —
// misma frase de confirmación escrita que el resto de acciones sensibles.
// Root y Super Root (general.caja.editar_movimiento), no exclusivo de Super Root.
export const anularVentaSchema = z.object({
  nota: z.string().trim().min(3).max(300),
  confirmacion: z.literal("ANULAR VENTA"),
});
export type AnularVentaInput = z.infer<typeof anularVentaSchema>;

export const fechaParamSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
});
export type FechaParamInput = z.infer<typeof fechaParamSchema>;
