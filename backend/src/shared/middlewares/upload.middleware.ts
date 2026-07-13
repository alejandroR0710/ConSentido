import fs from "fs";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "path";

// Ancla en process.cwd() (siempre backend/, por convención de "npm run dev/start" ahí)
// en vez de __dirname: con tsx el código corre directo desde src/, así que __dirname
// aquí caería en src/shared/middlewares y produciría una ruta distinta a la que usa
// app.ts para servir /uploads estático.
//
// EXCEPCIÓN: en una función serverless (Vercel) el sistema de archivos es de
// solo lectura salvo /tmp — escribir en process.cwd() ahí tira EROFS/EACCES al
// arrancar (antes de poder atender cualquier petición) y tumba toda la función,
// no solo la subida de fotos. `process.env.VERCEL` lo define Vercel automático.
// Ojo: /tmp no es persistente entre invocaciones ni se comparte entre instancias
// — esto solo evita el crash, no resuelve que las fotos se pierdan en serverless
// (para eso hace falta un storage real, ver nota más abajo).
const UPLOADS_ROOT = process.env.VERCEL ? path.join("/tmp", "uploads") : path.join(process.cwd(), "uploads");

/**
 * Uploader de disco local por subcarpeta (ej. "productos", "insumos"). Suficiente
 * para desarrollo local; si el proyecto se despliega a un entorno con disco
 * efímero (ej. Render/Railway/Vercel), esto debería migrar a Supabase Storage u
 * otro almacenamiento persistente (ya contemplado en FASE4_ARQUITECTURA_TECNICA.md).
 */
export function crearUploaderImagen(subcarpeta: string) {
  const destino = path.join(UPLOADS_ROOT, subcarpeta);
  try {
    fs.mkdirSync(destino, { recursive: true });
  } catch (err) {
    // Nunca debe tumbar el arranque del servidor por esto: en el peor caso, la
    // subida de fotos falla más adelante (con un error claro), pero el resto de
    // la app sigue funcionando.
    console.error(`No se pudo crear la carpeta de uploads (${destino}):`, err);
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destino),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) {
        cb(new Error("Solo se permiten archivos de imagen"));
        return;
      }
      cb(null, true);
    },
  });
}

export function rutaPublicaImagen(subcarpeta: string, filename: string) {
  return `/uploads/${subcarpeta}/${filename}`;
}

/** Para que app.ts sirva /uploads desde la misma carpeta donde este archivo escribe. */
export function obtenerCarpetaUploads() {
  return UPLOADS_ROOT;
}
