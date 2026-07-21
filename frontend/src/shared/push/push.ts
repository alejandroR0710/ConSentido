import { notificacionesApi } from "./api";

/** El navegador espera la clave VAPID como Uint8Array, no como el string
 *  base64url que da la API — conversión estándar recomendada por la spec. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function notificacionesSoportadas(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function notificacionesActivas(): boolean {
  return notificacionesSoportadas() && Notification.permission === "granted";
}

/**
 * Pide permiso de notificaciones y suscribe este dispositivo al servidor.
 * Debe llamarse desde un gesto real del usuario (un tap/clic) — los
 * navegadores no dejan pedir el permiso desde código que corre solo
 * (ej. un useEffect al cargar la página).
 */
export async function activarNotificaciones(): Promise<boolean> {
  if (!notificacionesSoportadas()) return false;

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") return false;

  const { clavePublica } = await notificacionesApi.obtenerClavePublica();
  if (!clavePublica) return false;

  const registro = await navigator.serviceWorker.ready;
  let suscripcion = await registro.pushManager.getSubscription();
  if (!suscripcion) {
    suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(clavePublica) as BufferSource,
    });
  }

  await notificacionesApi.suscribir(suscripcion.toJSON());
  return true;
}
