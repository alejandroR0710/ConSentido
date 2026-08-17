import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { AuthProvider } from "./shared/auth/AuthProvider.tsx";
import "./index.css";
import "./shared/print/print.css";

// Con registerType:"autoUpdate" (vite.config.ts) el Service Worker se activa
// y recarga la página solo en cuanto detecta una versión nueva — pero el
// navegador solo revisa si hay una versión nueva al navegar o recargar. Una
// tablet de cocina se queda con la misma pestaña abierta todo el día sin
// recargar nunca, así que sin este chequeo periódico se quedaba pegada
// indefinidamente en el código viejo aunque ya se hubiera desplegado el
// arreglo (esto explicaba por qué el ajuste de la grilla de Cocina para
// tablet no se veía reflejado).
registerSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), 5 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
