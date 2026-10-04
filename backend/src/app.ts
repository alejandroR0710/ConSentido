import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { analyticsRouter } from "./modules/general/analytics/analytics.routes";
import { authRouter } from "./modules/general/auth/auth.routes";
import { cajaRouter } from "./modules/general/caja/caja.routes";
import { concretoRouter } from "./modules/concreto/concreto.routes";
import { conSentidoRouter } from "./modules/con_sentido/con_sentido.routes";
import { insumosRouter } from "./modules/insumos/insumos.routes";
import { integracionEcommerceRouter } from "./modules/integracion_ecommerce/integracion_ecommerce.routes";
import { notificacionesRouter } from "./modules/general/notificaciones/notificaciones.routes";
import { usuariosRouter } from "./modules/general/usuarios/usuarios.routes";
import { migaoRouter } from "./modules/migao/migao.routes";
import { pedidosRouter } from "./modules/pedidos/pedidos.routes";
import { velasRouter } from "./modules/velas/velas.routes";
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

  // Datos en vivo (colas de Cocina/Mesero, caja...): ningún navegador, service
  // worker ni proxy debe guardarlos. Una respuesta vieja servida desde caché
  // hacía que una acción ya hecha se viera deshecha en el siguiente refresco.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // Sincronización de inventario con el e-commerce (servidor a servidor, con
  // x-sync-key — no usa la sesión de usuario). Ver modules/integracion_ecommerce.
  app.use("/api/integraciones/ecommerce", integracionEcommerceRouter);

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/con-sentido", conSentidoRouter);
  app.use("/api/v1/insumos", insumosRouter);
  app.use("/api/v1/caja", cajaRouter);
  app.use("/api/v1/migao", migaoRouter);
  app.use("/api/v1/velas", velasRouter);
  app.use("/api/v1/concreto", concretoRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/notificaciones", notificacionesRouter);
  app.use("/api/v1/usuarios", usuariosRouter);
  app.use("/api/v1/pedidos", pedidosRouter);

  // Hosting (cPanel): el mismo proceso sirve el frontend compilado, así API
  // y página quedan en el mismo dominio (frontend construido con
  // VITE_API_URL=/api/v1, sin CORS). Carpeta: FRONTEND_DIR o ./public junto
  // al backend. Si no existe (desarrollo local), no se sirve nada.
  const carpetaFrontend = path.resolve(process.env.FRONTEND_DIR ?? path.join(process.cwd(), "public"));
  if (fs.existsSync(path.join(carpetaFrontend, "index.html"))) {
    app.use(express.static(carpetaFrontend, { index: false }));
    app.get(/^\/(?!api\/|uploads\/|health$).*/, (_req, res) => {
      res.sendFile(path.join(carpetaFrontend, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
