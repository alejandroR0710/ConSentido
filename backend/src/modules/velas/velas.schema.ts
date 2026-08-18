import { z } from "zod";

export const crearCeraSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  presentacionKg: z.number().positive(),
  precioCompra: z.number().positive(),
  proveedor: z.string().trim().max(120).optional(),
});
export type CrearCeraInput = z.infer<typeof crearCeraSchema>;
export const actualizarCeraSchema = crearCeraSchema.partial().extend({ activo: z.boolean().optional() });
export type ActualizarCeraInput = z.infer<typeof actualizarCeraSchema>;

export const crearFraganciaSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  presentacionG: z.number().positive().default(1000),
  precioCompra: z.number().positive(),
});
export type CrearFraganciaInput = z.infer<typeof crearFraganciaSchema>;
export const actualizarFraganciaSchema = crearFraganciaSchema.partial().extend({ activo: z.boolean().optional() });
export type ActualizarFraganciaInput = z.infer<typeof actualizarFraganciaSchema>;

export const crearPabiloSchema = z.object({
  talla: z.string().trim().min(1).max(10),
  longitudM: z.number().positive(),
  precioCarrete: z.number().positive(),
});
export type CrearPabiloInput = z.infer<typeof crearPabiloSchema>;
export const actualizarPabiloSchema = crearPabiloSchema.partial().extend({ activo: z.boolean().optional() });
export type ActualizarPabiloInput = z.infer<typeof actualizarPabiloSchema>;

// Recipiente/tapa/empaque/decoración/identidad/papelería/protección/otro —
// ver database/schema.sql sección "5B" para el detalle de cada categoría.
const CATEGORIAS_INSUMO = [
  "recipiente",
  "tapa",
  "empaque",
  "decoracion",
  "identidad",
  "papeleria",
  "proteccion",
  "otro",
] as const;
const UNIDADES_COSTO = ["unidad", "cm", "g", "hoja", "metro"] as const;

export const crearInsumoVelaSchema = z.object({
  codigo: z.string().trim().max(30).optional(),
  nombre: z.string().trim().min(2).max(120),
  categoria: z.enum(CATEGORIAS_INSUMO),
  unidadCosto: z.enum(UNIDADES_COSTO),
  valorUnitario: z.number().positive(),
  // Solo de referencia, para que el admin calcule valorUnitario a mano
  // (ej. "docena a $48.000 = $4.000 c/u") — el cálculo de una receta
  // siempre usa valorUnitario directo, nunca vuelve a dividir.
  cantidadPorPaquete: z.number().positive().optional(),
  precioPaquete: z.number().positive().optional(),
  proveedor: z.string().trim().max(120).optional(),
});
export type CrearInsumoVelaInput = z.infer<typeof crearInsumoVelaSchema>;
export const actualizarInsumoVelaSchema = crearInsumoVelaSchema.partial().extend({ activo: z.boolean().optional() });
export type ActualizarInsumoVelaInput = z.infer<typeof actualizarInsumoVelaSchema>;

export const actualizarParametrosSchema = z.object({
  multiplicadorPrecio: z.number().positive(),
});
export type ActualizarParametrosInput = z.infer<typeof actualizarParametrosSchema>;

// Determina qué % del peso total NO queda como cera aprovechable (se pierde
// en el proceso) — cada tipo de vela tiene su propia merma de fabricación,
// ver TIPO_VELA_MERMA_PORCENTAJE en velas.service.ts.
const TIPOS_VELA = ["decorativa", "decorativa_8", "vaso", "wax_melt"] as const;

// Composición de una receta — la misma forma la usa tanto POST /calcular
// (no persiste nada) como crear/editar una receta guardada, para que el
// cálculo sea EXACTAMENTE el mismo en los dos casos (una sola función en el
// service, ver velas.service.ts::calcularCostoReceta).
const recetaBaseSchema = z.object({
  tipoVela: z.enum(TIPOS_VELA).default("decorativa"),
  // Peso TOTAL pesado (bruto) — el peso de cera realmente aprovechable se
  // deriva descontando la merma del tipo de vela, nunca se pide aparte.
  pesoMezclaG: z.number().positive(),
  ceras: z.array(z.object({ ceraId: z.string().uuid(), gramos: z.number().positive() })).min(
    1,
    "Agrega al menos una cera",
  ),
  fragancias: z
    .array(z.object({ fraganciaId: z.string().uuid(), porcentaje: z.number().positive() }))
    .default([]),
  pabiloId: z.string().uuid().optional(),
  cmPabilo: z.number().positive().optional(),
  // Del catálogo (insumoId) O escrito a mano para esa receta puntual
  // (nombreManual+valorUnitarioManual, sin agregarlo al catálogo) — nunca
  // los dos a la vez.
  insumos: z
    .array(
      z.union([
        z.object({ insumoId: z.string().uuid(), cantidad: z.number().positive() }),
        z.object({
          nombreManual: z.string().trim().min(2).max(120),
          valorUnitarioManual: z.number().positive(),
          cantidad: z.number().positive(),
        }),
      ]),
    )
    .default([]),
  // Monto fijo que el usuario escribe a mano, no minutos × tarifa.
  costoManoObra: z.number().nonnegative().default(0),
  // undefined = usa el multiplicador global de velas_parametros.
  multiplicadorPrecio: z.number().positive().optional(),
  redondeo: z.union([z.literal(0), z.literal(100), z.literal(500), z.literal(1000)]).default(100),
});
export const calcularRecetaSchema = recetaBaseSchema;
export type CalcularRecetaInput = z.infer<typeof calcularRecetaSchema>;

export const crearProductoVelaSchema = recetaBaseSchema.extend({
  nombre: z.string().trim().min(2).max(150),
  notas: z.string().trim().max(300).optional(),
  precioFinalAutorizado: z.number().positive().optional(),
});
export type CrearProductoVelaInput = z.infer<typeof crearProductoVelaSchema>;

export const actualizarProductoVelaSchema = crearProductoVelaSchema.partial().extend({
  activo: z.boolean().optional(),
});
export type ActualizarProductoVelaInput = z.infer<typeof actualizarProductoVelaSchema>;
