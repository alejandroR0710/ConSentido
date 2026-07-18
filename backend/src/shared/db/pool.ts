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
  // Todo el "historial por día" de la app (Caja, analíticas) filtra con
  // to_char(columna, 'YYYY-MM-DD'), que Postgres convierte a la zona horaria
  // de la SESIÓN antes de formatear. Sin esto, un proveedor en la nube (ej.
  // Supabase) usa UTC por defecto: una orden cerrada después de las 7pm hora
  // Colombia cae en el día "siguiente" en UTC y desaparece del filtro de
  // "hoy" — el negocio opera en Colombia (ver formatMoney, locale "es-CO"),
  // así que cada conexión del pool fija esta zona horaria explícitamente.
  options: "-c TimeZone=America/Bogota",
});

pool.on("error", (err) => {
  console.error("Error inesperado en el pool de PostgreSQL", err);
});
