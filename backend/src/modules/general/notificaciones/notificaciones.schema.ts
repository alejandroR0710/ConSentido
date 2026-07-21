import { z } from "zod";

// Forma estándar de PushSubscriptionJSON que entrega el navegador
// (`PushSubscription.toJSON()`), no hace falta más que esto para poder
// mandarle un push después con web-push.
export const suscribirSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type SuscribirInput = z.infer<typeof suscribirSchema>;

export const desuscribirSchema = z.object({
  endpoint: z.string().url(),
});
export type DesuscribirInput = z.infer<typeof desuscribirSchema>;
