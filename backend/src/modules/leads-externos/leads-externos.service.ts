import { AppError } from "../../shared/utils/app-error";
import type { EnviarLeadInput } from "./leads-externos.schema";

// ============================================================================
// Config del servicio externo — A PROPÓSITO sin variable de entorno (decisión
// del negocio): la URL y la clave quedan fijas acá, solo dentro del backend
// (nunca llegan al navegador). Reemplaza estos dos valores cuando el servicio
// externo quede publicado de verdad (dominio/IP pública + clave definitiva).
// ============================================================================
const EXTERNAL_LEAD_URL = "http://IP_DE_TU_PC:4321/api/external-lead"; // TODO: URL pública real
const EXTERNAL_LEAD_API_KEY = "tu_clave_segura"; // TODO: clave real del servicio externo

/**
 * Reenvía el lead capturado en el header al bot/servicio externo (otro
 * proyecto, fuera de este repo). No guarda nada en esta base de datos — es
 * un simple proxy que evita exponer la x-api-key en el navegador.
 */
export async function enviarLead(input: EnviarLeadInput) {
  let res: globalThis.Response;
  try {
    res = await fetch(EXTERNAL_LEAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": EXTERNAL_LEAD_API_KEY,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AppError(
      502,
      "EXTERNAL_LEAD_UNREACHABLE",
      "No se pudo contactar el servicio externo. Verifica que esté encendido y accesible.",
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
        : `El servicio externo respondió ${res.status}`;
    throw new AppError(502, "EXTERNAL_LEAD_ERROR", mensaje);
  }

  return cuerpo;
}
