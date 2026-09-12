// El bot vive en la misma red que la PC del negocio (WhatsApp + sesión
// local), conectada por cable Ethernet — no es alcanzable desde nuestro
// backend en Render (nube), así que esto se llama DIRECTO desde el navegador
// de quien use el botón del header. Solo funciona si ese dispositivo está
// conectado a esa misma red.
const EXTERNAL_LEAD_URL = "http://192.168.0.15:4321/api/external-lead"; // TODO: actualizar si cambia la IP de esa PC
const EXTERNAL_LEAD_API_KEY = ""; // el bot todavía no exige x-api-key; pon el valor acá si se activa

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

export const leadsExternosApi = {
  async enviar(input: EnviarLeadInput): Promise<unknown> {
    let res: Response;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (EXTERNAL_LEAD_API_KEY) headers["x-api-key"] = EXTERNAL_LEAD_API_KEY;
      res = await fetch(EXTERNAL_LEAD_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
    } catch {
      // Falla típica: el dispositivo no está en la misma Wi-Fi que la PC del
      // bot, o el bot está apagado — no hay forma de distinguirlas desde acá.
      throw new Error(
        "No se pudo contactar el bot. Verifica que este dispositivo esté conectado a la misma red Wi-Fi que la PC donde corre, y que esté encendido.",
      );
    }

    const texto = await res.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = texto || null;
    }

    if (!res.ok) {
      const mensaje =
        cuerpo && typeof cuerpo === "object" && "message" in cuerpo && typeof (cuerpo as { message: unknown }).message === "string"
          ? (cuerpo as { message: string }).message
          : `El bot respondió ${res.status}`;
      throw new Error(mensaje);
    }

    return cuerpo;
  },
};
