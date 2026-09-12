import { apiFetch } from "./client";

export interface EnviarLeadInput {
  phone: string;
  name: string;
  params: {
    showWorkshops: boolean;
    showExperience: boolean;
    includeImages: boolean;
    sendCatalog: boolean;
  };
}

// El backend solo hace de proxy hacia el servicio externo (bot/catálogo, otro
// proyecto fuera de este repo) — ver leads-externos.service.ts para dónde
// queda la URL y la clave real.
export const leadsExternosApi = {
  enviar: (input: EnviarLeadInput) => apiFetch<unknown>("/leads-externos", { method: "POST", body: input }),
};
