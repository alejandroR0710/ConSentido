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

// lib.dom.d.ts todavía no declara `vibrate` en NotificationOptions, aunque
// el navegador sí lo soporta (extensión de la spec) — se completa a mano.
type NotificationOptionsConVibrate = NotificationOptions & { vibrate?: number[] };

/** Notificaciones push (Web Push/VAPID): llegan aunque la pestaña esté
 *  cerrada o el celular bloqueado — ver notificaciones.service.ts en el
 *  backend, que es quien dispara esto (pedido nuevo en Cocina, orden lista
 *  en Mesero, alarma de pedidos). El sonido/vibración en segundo plano los
 *  controla el sistema operativo, no esta página — la API de Notification
 *  no permite elegir un audio propio (eso sí lo hace beep.ts, pero solo
 *  funciona con la app abierta en primer plano). `vibrate` + `tag` +
 *  `renotify` son lo que sí está en nuestras manos para que no pase
 *  desapercibida: que vibre siempre y que una alarma repetida para el MISMO
 *  pedido reemplace la anterior en vez de apilarse, pero sin dejar de sonar/
 *  vibrar cada vez. */
self.addEventListener("push", (event) => {
  const datos: DatosNotificacionPush = event.data?.json() ?? {};
  const url = datos.url ?? "/";
  event.waitUntil(
    self.registration.showNotification(datos.titulo ?? "Con Sentido", {
      body: datos.cuerpo,
      icon: "/icons/icon.svg",
      data: { url },
      vibrate: [200, 100, 200],
      tag: url,
      renotify: true,
    } as NotificationOptionsConVibrate),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(self.clients.openWindow(url));
});
