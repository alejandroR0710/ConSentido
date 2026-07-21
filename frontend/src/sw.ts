/// <reference lib="webworker" />
import { precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";

// `self` en un service worker no es el `self` de DOM (por eso este archivo
// tiene su propio tsconfig.sw.json con lib "WebWorker" en vez de "DOM") —
// `__WB_MANIFEST` lo inyecta vite-plugin-pwa al compilar (injectManifest).
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Igual que el runtimeCaching que antes vivía en vite.config.ts (modo
// generateSW): lecturas de la API quedan en caché para revisitas rápidas.
// Las escrituras (POST/PATCH) nunca pasan por acá, Workbox no las intercepta.
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/v1/"),
  new StaleWhileRevalidate({ cacheName: "api-cache" }),
);

interface DatosNotificacionPush {
  titulo?: string;
  cuerpo?: string;
  url?: string;
}

/** Notificaciones push (Web Push/VAPID): llegan aunque la pestaña esté
 *  cerrada o el celular bloqueado — ver notificaciones.service.ts en el
 *  backend, que es quien dispara esto (pedido nuevo en Cocina, orden lista
 *  en Mesero). */
self.addEventListener("push", (event) => {
  const datos: DatosNotificacionPush = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(datos.titulo ?? "Con Sentido", {
      body: datos.cuerpo,
      icon: "/icons/icon.svg",
      data: { url: datos.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(self.clients.openWindow(url));
});
