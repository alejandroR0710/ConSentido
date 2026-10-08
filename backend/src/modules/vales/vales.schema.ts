import { z } from "zod";
import { referenciaBancoSchema } from "../../shared/utils/pago-mixto";

const METODOS_PAGO = ["efectivo", "banco"] as const;
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";

// Mismo patrón que registrarEgresoSchema (caja.schema.ts) — "mixto" no es un
// método real en la base, se descompone en 1-2 líneas puras al guardar. Un
// vale/préstamo nunca pide referenciaBanco (esa regla es solo para pagos
// recibidos — ver cobrarValeSchema más abajo, que SÍ la necesita).
const pagoValeSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive() }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type PagoValeInput = z.infer<typeof pagoValeSchema>;

const FUENTES = ["turno", "acumulado", "dueno"] as const;
export type FuenteVale = (typeof FUENTES)[number];

const TIPOS = ["pago", "deuda"] as const;
export type TipoVale = (typeof TIPOS)[number];

const camposComunes = {
  pagadoA: z.string().trim().min(1, "Escribe a quién corresponde este vale").max(150),
  destinatarioUsuarioId: z.string().uuid().optional(),
  destinatarioDocumento: z.string().trim().max(30).optional(),
  concepto: z.string().trim().min(1, "Escribe el concepto del vale").max(500),
};

// Un vale "pago" (dinero que ya salió, tipo por defecto si se omite), o una
// "deuda" CON préstamo inicial (también sale dinero real, pero queda
// pendiente de cobrar después) — misma forma en los dos casos, solo cambia
// qué significa `tipo`.
const conFuenteSchema = z
  .object({
    ...camposComunes,
    tipo: z.enum(TIPOS).default("pago"),
    fuente: z.enum(FUENTES),
    // Obligatorio solo si fuente==="dueno" — se valida en el service (ahí
    // también se confirma que ese usuario de verdad sea Root o Super Root).
    duenoId: z.string().uuid().optional(),
  })
  .and(pagoValeSchema)
  .refine((d) => d.fuente !== "dueno" || Boolean(d.duenoId), {
    message: "Elige de qué dueño salió el dinero",
    path: ["duenoId"],
  });

// Una "deuda" SIN préstamo inicial: no toca Caja para nada al crearla, solo
// queda registrado cuánto debe (ej. un daño que el empleado tiene que asumir).
const sinFuenteSchema = z.object({
  ...camposComunes,
  tipo: z.literal("deuda"),
  montoAdeudado: z.number().positive(),
});

export const crearValeSchema = z.union([conFuenteSchema, sinFuenteSchema]);
export type CrearValeInput = z.infer<typeof crearValeSchema>;

export const reponerValeSchema = z.object({
  fuenteReposicion: z.enum(["turno", "acumulado"]),
});
export type ReponerValeInput = z.infer<typeof reponerValeSchema>;

// Cobrar una deuda es un INGRESO (dinero que entra), al revés de crear un
// vale (siempre egreso) — por eso SÍ necesita referenciaBanco cuando hay
// banco de por medio (ver pago-mixto.ts::exigirReferenciaBanco, que corre
// dentro de cajaService.registrarIngreso).
export const cobrarValeSchema = z.union([
  z.object({ metodoPago: z.enum(METODOS_PAGO), monto: z.number().positive(), ...referenciaBancoSchema }),
  z
    .object({
      metodoPago: z.literal("mixto"),
      montoEfectivo: z.number().nonnegative(),
      montoBanco: z.number().nonnegative(),
      ...referenciaBancoSchema,
    })
    .refine((d) => d.montoEfectivo + d.montoBanco > 0, { message: MENSAJE_MIXTO_VACIO, path: ["montoEfectivo"] }),
]);
export type CobrarValeInput = z.infer<typeof cobrarValeSchema>;
