import { z } from "zod";

// Formulario del botón "Enviar lead" del header: cualquier usuario logueado
// puede registrar un contacto interesado y reenviarlo al bot externo (fuera
// de este repo) que arma la conversación/catálogo — ver leads-externos.service.ts.
export const enviarLeadSchema = z.object({
  phone: z.string().trim().min(5, "El teléfono es obligatorio").max(20),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(150),
  params: z.object({
    showWorkshops: z.boolean().default(false),
    showExperience: z.boolean().default(false),
    includeImages: z.boolean().default(false),
    sendCatalog: z.boolean().default(false),
  }),
});
export type EnviarLeadInput = z.infer<typeof enviarLeadSchema>;
