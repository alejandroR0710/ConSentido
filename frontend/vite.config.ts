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
      // injectManifest (en vez de generateSW, el default): hace falta un
      // service worker propio (src/sw.ts) para poder escuchar el evento
      // "push" — generateSW no permite agregar código propio al SW.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
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
      // El runtimeCaching de la API ahora vive dentro de src/sw.ts (injectManifest
      // no lee esta opción, es exclusiva del modo generateSW).
    }),
  ],
});
