import webpush from "web-push";
import * as repo from "./notificaciones.repository";
import { DesuscribirInput, SuscribirInput } from "./notificaciones.schema";

const clavePublica = process.env.VAPID_PUBLIC_KEY;
const clavePrivada = process.env.VAPID_PRIVATE_KEY;
const asunto = process.env.VAPID_SUBJECT ?? "mailto:admin@sistemapos.local";

if (clavePublica && clavePrivada) {
  webpush.setVapidDetails(asunto, clavePublica, clavePrivada);
}

export function obtenerClavePublica() {
  return clavePublica ?? null;
}

export async function suscribir(usuarioId: string, input: SuscribirInput, userAgent?: string) {
  await repo.upsertSuscripcion({
    usuarioId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent,
  });
}

export async function desuscribir(usuarioId: string, input: DesuscribirInput) {
  await repo.borrarSuscripcionPorEndpoint(usuarioId, input.endpoint);
}

export interface PayloadNotificacion {
  titulo: string;
  cuerpo: string;
  url?: string;
}

/** Manda el push a una lista de suscripciones ya cargada; si el navegador
 *  devuelve 404/410 (la suscripción venció — el usuario desinstaló la PWA o
 *  revocó el permiso), se borra sola en vez de seguir reintentando para
 *  siempre. Nunca lanza: quien llama nunca debe fallar por esto. */
async function enviarASuscripciones(suscripciones: repo.PushSuscripcion[], payload: PayloadNotificacion) {
  const cuerpo = JSON.stringify(payload);
  await Promise.all(
    suscripciones.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          cuerpo,
        );
      } catch (err) {
        if (err instanceof webpush.WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await repo.borrarSuscripcionVencida(s.endpoint).catch(() => {});
        }
      }
    }),
  );
}

/** Avisa a todos los usuarios que tengan el rol indicado (ej. todo Cocina),
 *  no solo a quien esté de turno en ese momento. */
export async function enviarATodosDeRol(rolNombre: string, payload: PayloadNotificacion) {
  if (!clavePublica || !clavePrivada) return;
  const suscripciones = await repo.listSuscripcionesPorRol(rolNombre);
  await enviarASuscripciones(suscripciones, payload);
}

export async function enviarAUsuario(usuarioId: string, payload: PayloadNotificacion) {
  if (!clavePublica || !clavePrivada) return;
  const suscripciones = await repo.listSuscripcionesPorUsuario(usuarioId);
  await enviarASuscripciones(suscripciones, payload);
}
