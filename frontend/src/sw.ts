/// <reference lib="webworker" />
import { precacheAndRoute, type PrecacheEntry } from "workbox-precaching";

// `self` en un service worker no es el `self` de DOM (por eso este archivo
// tiene su propio tsconfig.sw.json con lib "WebWorker" en vez de "DOM") —
// `__WB_MANIFEST` lo inyecta vite-plugin-pwa al compilar (injectManifest).
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

precacheAndRoute(self.__WB_MANIFEST);

// La API NO se guarda en caché: va siempre directo a la red. Antes había un
// StaleWhileRevalidate sobre /api/v1/, que responde cada GET con la respuesta
// ANTERIOR y baja la nueva en segundo plano para la próxima vez. En pantallas
// que se refrescan solas (Cocina cada 5 s) eso hacía que una acción ya hecha
// ("Empezar a preparar", el check de un producto) se viera deshecha en el
// siguiente refresco y volviera a aparecer en el otro. Además la caché se
// compartía entre usuarios del mismo dispositivo.
// Se borra la caché que haya quedado de versiones anteriores.
//
// skipWaiting + clients.claim: registerType "autoUpdate" (vite.config.ts) no
// los agrega solo en modo injectManifest. Sin ellos, una versión nueva del SW
// se queda esperando hasta que se cierren TODAS las pestañas — la tablet de
// cocina nunca cierra la suya, así que seguía con el código viejo.
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([caches.delete("api-cache"), self.clients.claim()]));
});

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
