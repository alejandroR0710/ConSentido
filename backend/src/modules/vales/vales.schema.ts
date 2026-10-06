import { z } from "zod";

const METODOS_PAGO = ["efectivo", "banco"] as const;
const MENSAJE_MIXTO_VACIO = "El total del pago mixto debe ser mayor a 0";

// Mismo patrón que registrarEgresoSchema (caja.schema.ts) — "mixto" no es un
// método real en la base, se descompone en 1-2 líneas puras al guardar. Un
// vale nunca pide referenciaBanco (esa regla es solo para pagos recibidos).
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

const FUENTES = ["turno", "acumulado", "dueno"] as const;
export type FuenteVale = (typeof FUENTES)[number];

export const crearValeSchema = z
  .object({
    pagadoA: z.string().trim().min(1, "Escribe a quién se le pagó").max(150),
    destinatarioUsuarioId: z.string().uuid().optional(),
    destinatarioDocumento: z.string().trim().max(30).optional(),
    concepto: z.string().trim().min(1, "Escribe el concepto del vale").max(500),
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
export type CrearValeInput = z.infer<typeof crearValeSchema>;

export const reponerValeSchema = z.object({
  fuenteReposicion: z.enum(["turno", "acumulado"]),
});
export type ReponerValeInput = z.infer<typeof reponerValeSchema>;
