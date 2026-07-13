import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida. Copia .env.example a .env y configúrala.");
}

// Los proveedores de Postgres en la nube (Supabase, Neon, Render...) exigen SSL;
// Postgres local (dev, con trust auth en 127.0.0.1) no lo soporta ni lo necesita.
// rejectUnauthorized:false porque node-postgres no trae el CA de estos
// proveedores por defecto — es el patrón estándar para conectarse a ellos.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de PostgreSQL", err);
});
