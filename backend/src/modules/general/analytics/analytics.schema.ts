import { z } from "zod";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const analyticsRangoSchema = z
  .object({
    desde: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
    hasta: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)"),
  })
  .refine((d) => d.desde <= d.hasta, { message: "'desde' no puede ser posterior a 'hasta'", path: ["desde"] });
export type AnalyticsRangoInput = z.infer<typeof analyticsRangoSchema>;
