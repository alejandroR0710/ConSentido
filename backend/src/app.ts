import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { analyticsRouter } from "./modules/general/analytics/analytics.routes";
import { authRouter } from "./modules/general/auth/auth.routes";
import { cajaRouter } from "./modules/general/caja/caja.routes";
import { conSentidoRouter } from "./modules/con_sentido/con_sentido.routes";
import { insumosRouter } from "./modules/insumos/insumos.routes";
import { notificacionesRouter } from "./modules/general/notificaciones/notificaciones.routes";
import { usuariosRouter } from "./modules/general/usuarios/usuarios.routes";
import { migaoRouter } from "./modules/migao/migao.routes";
import { errorHandler, notFoundHandler } from "./shared/middlewares/error-handler";
import { obtenerCarpetaUploads } from "./shared/middlewares/upload.middleware";

// Rangos de IP privada (RFC 1918) + loopback: cualquier red Wi-Fi local (casa,
// oficina, la del cliente) usa una IP en alguno de estos rangos. Aceptar el
// puerto del dev server de Vite (5173) en cualquiera de ellas evita tener que
// actualizar CORS_ORIGIN cada vez que la máquina se conecta a una red distinta.
const RANGOS_IP_PRIVADA = [
  /^localhost$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,
];

function esOrigenDeRedLocal(origin: string): boolean {
  try {
    const { hostname, port } = new URL(origin);
    return port === "5173" && RANGOS_IP_PRIVADA.some((patron) => patron.test(hostname));
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();

  // CORS_ORIGIN admite una lista explícita separada por comas (para producción,
  // ej. el dominio real del frontend); además de esa lista, siempre se acepta
  // cualquier origen de red local en el puerto 5173 (ver esOrigenDeRedLocal).
  const origenesExplicitos = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origen) => origen.trim());

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origenesExplicitos.includes(origin) || esOrigenDeRedLocal(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origen no permitido por CORS: ${origin}`));
        }
      },
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Fotos de productos/insumos servidas como archivos estáticos (ver upload.middleware.ts
  // para de dónde sale esta ruta — cambia entre local/serverless).
  app.use("/uploads", express.static(obtenerCarpetaUploads()));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/con-sentido", conSentidoRouter);
  app.use("/api/v1/insumos", insumosRouter);
  app.use("/api/v1/caja", cajaRouter);
  app.use("/api/v1/migao", migaoRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/notificaciones", notificacionesRouter);
  app.use("/api/v1/usuarios", usuariosRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
