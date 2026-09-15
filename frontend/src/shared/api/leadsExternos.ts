// El bot vive en la misma red que la PC del negocio (WhatsApp + sesión
// local), conectada por cable Ethernet — no es alcanzable desde nuestro
// backend en Render (nube), así que esto se llama DIRECTO desde el navegador
// de quien use el botón del header. Solo funciona si ese dispositivo está
// conectado a esa misma red.
const EXTERNAL_LEAD_URL = "http://192.168.0.15:4321/api/external-lead"; // TODO: actualizar si cambia la IP de esa PC
// La clave SÍ sale de env var (VITE_EXTERNAL_LEAD_API_KEY, ver .env.example)
// para no dejarla escrita en el código/git — aunque igual queda visible en el
// JS ya compilado para quien abra la página, porque esta llamada sale del
// navegador (ver comentario de arriba). La env var solo evita que quede en
// el historial de git.
const EXTERNAL_LEAD_API_KEY = import.meta.env.VITE_EXTERNAL_LEAD_API_KEY ?? "";

// Los 4 tipos reales que entiende el bot — el bot recibe una LISTA (se puede
// marcar más de uno, no hace falta marcarlos todos). "Todo junto" en el
// formulario NO es un 5º valor: es un atajo de UI que marca estos 4 a la vez
// (ver BotonLeadExterno.tsx), para no mandar "all" Y los sueltos duplicado.
export type TipoLead = "experience" | "basic" | "advanced" | "concrete";

export interface EnviarLeadInput {
  phone: string;
  name: string;
  params: { type: TipoLead[] };
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
