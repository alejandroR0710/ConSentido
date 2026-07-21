import { apiFetch } from "../api/client";

export const notificacionesApi = {
  obtenerClavePublica: () => apiFetch<{ clavePublica: string | null }>("/notificaciones/clave-publica"),
  suscribir: (subscription: PushSubscriptionJSON) =>
    apiFetch<{ suscrito: boolean }>("/notificaciones/suscribir", { method: "POST", body: subscription }),
  desuscribir: (endpoint: string) =>
    apiFetch<{ desuscrito: boolean }>("/notificaciones/suscribir", { method: "DELETE", body: { endpoint } }),
};
