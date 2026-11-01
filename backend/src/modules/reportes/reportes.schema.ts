import { z } from "zod";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const reportesRangoSchema = z
  .object({
    desde: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
    hasta: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  })
  .refine((d) => d.desde <= d.hasta, { message: "'desde' no puede ser posterior a 'hasta'", path: ["desde"] });
export type ReportesRangoInput = z.infer<typeof reportesRangoSchema>;

// `reportesRangoSchema.extend(...)` no compila: `.refine()` envuelve el
// ZodObject en un ZodEffects, que no tiene `.extend` (ningún otro *.schema.ts
// del backend hace `.extend()` sobre un esquema ya refinado). `z.intersection`
// logra lo mismo — valida el rango con su refine tal cual más los 3 filtros
// propios de Ventas — sin tocar el `reportesRangoSchema` que ya usa Task 2.
export const reportesVentasFiltrosSchema = z.intersection(
  reportesRangoSchema,
  z.object({
    metodo: z.enum(["efectivo", "banco"]).optional(),
    cliente: z.string().optional(),
    producto: z.string().optional(),
  }),
);
export type ReportesVentasFiltrosInput = z.infer<typeof reportesVentasFiltrosSchema>;

// Mismo patrón que `reportesVentasFiltrosSchema` arriba (z.intersection en
// vez de `.extend()`, que no compila sobre un ZodEffects ya refinado).
export const reportesGastosFiltrosSchema = z.intersection(
  reportesRangoSchema,
  z.object({
    categoriaId: z.coerce.number().int().positive().optional(),
    proveedorId: z.string().optional(),
    metodo: z.enum(["efectivo", "banco"]).optional(),
  }),
);
export type ReportesGastosFiltrosInput = z.infer<typeof reportesGastosFiltrosSchema>;

// Esquema propio (NO `reportesRangoSchema`): este reporte recibe un único
// `mes` (YYYY-MM), no un rango `desde`/`hasta` — ver reportes.service.ts::obtenerCierreCaja.
export const reportesCierreCajaSchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/, "Formato de mes inválido (YYYY-MM)"),
});
export type ReportesCierreCajaInput = z.infer<typeof reportesCierreCajaSchema>;
