import fs from "fs";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "path";

// Ancla en process.cwd() (siempre backend/, por convención de "npm run dev/start" ahí)
// en vez de __dirname: con tsx el código corre directo desde src/, así que __dirname
// aquí caería en src/shared/middlewares y produciría una ruta distinta a la que usa
// app.ts para servir /uploads estático.
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/**
 * Uploader de disco local por subcarpeta (ej. "productos", "insumos"). Suficiente
 * para desarrollo local; si el proyecto se despliega a un entorno con disco
 * efímero (ej. Render/Railway), esto debería migrar a Supabase Storage u otro
 * almacenamiento persistente (ya contemplado en FASE4_ARQUITECTURA_TECNICA.md).
 */
export function crearUploaderImagen(subcarpeta: string) {
  const destino = path.join(UPLOADS_ROOT, subcarpeta);
  fs.mkdirSync(destino, { recursive: true });

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
