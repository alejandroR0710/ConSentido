import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  // host: true expone el dev server en todas las interfaces de red (0.0.0.0), no
  // solo localhost, para que otros dispositivos en la misma red Wi-Fi puedan
  // entrar a http://<IP-de-esta-máquina>:5173.
  server: {
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/icon.svg"],
      manifest: {
        name: "Con Sentido / El Rinconcito del Migao",
        short_name: "Con Sentido",
        description: "ERP + POS + Inventario para microempresa",
        start_url: "/",
        display: "standalone",
        background_color: "#FBF3E1",
        theme_color: "#1F4A34",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Lecturas (catálogos, productos, mesas) se sirven de red y quedan en caché
        // para revisitas rápidas; las escrituras nunca pasan por el service worker
        // porque se hacen con POST/PATCH, que Workbox no intercepta por defecto.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/v1/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "api-cache" },
          },
        ],
      },
    }),
  ],
});
