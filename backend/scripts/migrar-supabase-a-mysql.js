/* eslint-disable */
// ============================================================================
// Migración de DATOS: PostgreSQL (Supabase) → archivo .sql para MySQL 8.
//
// Uso (desde la carpeta backend/):
//
//   SUPABASE_URL="postgresql://postgres.xxxx:CLAVE@aws-0-....pooler.supabase.com:5432/postgres" \
//     node scripts/migrar-supabase-a-mysql.js
//
// (en PowerShell: $env:SUPABASE_URL="postgresql://..."; node scripts/migrar-supabase-a-mysql.js)
//
// La URL está en Supabase → Project Settings → Database → Connection string
// (modo "Session", puerto 5432). Solo LEE de Supabase, nunca escribe.
//
// Genera database/mysql/datos.sql. En phpMyAdmin:
//   1. Importar database/mysql/schema.sql (base de datos vacía).
//   2. Importar database/mysql/datos.sql.
//
// Qué hace con cada tipo:
//   - Fechas con zona (timestamptz) → hora de Bogotá, con microsegundos,
//     igual que las guarda el backend en MySQL.
//   - boolean → 1/0; json/jsonb → texto JSON; numeric/bigint → tal cual.
//   - Columnas calculadas (subtotal, rentabilidad, valor_gramo...) se omiten:
//     MySQL las recalcula solo.
//   - Secuencias (número de comensal, número de factura) → tabla `secuencias`.
// ============================================================================

const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");
const mysql = require("mysql2");

const URL_ORIGEN = process.env.SUPABASE_URL || process.argv[2];
if (!URL_ORIGEN) {
  console.error("Falta SUPABASE_URL (la connection string de Supabase). Ver instrucciones al inicio del archivo.");
  process.exit(1);
}

const RAIZ = path.resolve(__dirname, "..", "..");
const ESQUEMA_MYSQL = path.join(RAIZ, "database", "mysql", "schema.sql");
const SALIDA = process.env.SALIDA || path.join(RAIZ, "database", "mysql", "datos.sql");
const FILAS_POR_INSERT = 200;

// Fechas y horas como texto crudo (sin pasar por Date de JS, que pierde
// microsegundos y aplica la zona horaria del PC).
types.setTypeParser(1184, (v) => v); // timestamptz
types.setTypeParser(1114, (v) => v); // timestamp
types.setTypeParser(1082, (v) => v); // date

const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(URL_ORIGEN);
const pg = new Pool({
  connectionString: URL_ORIGEN,
  ssl: esLocal ? undefined : { rejectUnauthorized: false },
  // Con la sesión en Bogotá, timestamptz sale como "2026-09-24 14:18:42.775396-05".
  options: "-c TimeZone=America/Bogota",
});

/** Tablas y columnas insertables del esquema MySQL (se omiten las GENERATED). */
function leerEsquemaMysql() {
  const sql = fs.readFileSync(ESQUEMA_MYSQL, "utf8");
  const tablas = new Map();
  const re = /CREATE TABLE (\w+) \(([\s\S]*?)\n\) ENGINE/g;
  let m;
  while ((m = re.exec(sql))) {
    const columnas = [];
    for (const linea of m[2].split("\n")) {
      const c = /^\s{2}([a-z_0-9]+)\s+[A-Z]/.exec(linea);
      if (!c) continue;
      if (["PRIMARY", "FOREIGN", "UNIQUE", "INDEX", "CHECK", "CONSTRAINT", "KEY"].includes(c[1].toUpperCase())) continue;
      if (/GENERATED ALWAYS/i.test(linea)) continue;
      columnas.push(c[1]);
    }
    tablas.set(m[1], columnas);
  }
  // ALTER TABLE ... ADD COLUMN (por si se agregan columnas fuera del CREATE).
  const alter = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g;
  while ((m = alter.exec(sql))) tablas.get(m[1])?.push(m[2]);
  return tablas;
}

function valorSql(valor, tipo) {
  if (valor === null || valor === undefined) return "NULL";
  if (tipo === "boolean") return valor ? "1" : "0";
  if (tipo === "timestamp with time zone") {
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2}(?::\d{2})?)$/.exec(valor);
    if (!m) throw new Error(`Fecha inesperada: ${valor}`);
    if (m[2] !== "-05" && m[2] !== "-05:00") throw new Error(`Fecha fuera de la zona de Bogotá: ${valor}`);
    return `'${m[1]}'`;
  }
  if (tipo === "json" || tipo === "jsonb") return mysql.escape(JSON.stringify(valor));
  if (typeof valor === "object" && !(valor instanceof Date)) return mysql.escape(JSON.stringify(valor));
  if (typeof valor === "number") return String(valor);
  return mysql.escape(String(valor));
}

async function main() {
  const esquema = leerEsquemaMysql();
  const salida = [];
  const avisos = [];

  salida.push(
    "-- Datos migrados desde PostgreSQL/Supabase — generado por backend/scripts/migrar-supabase-a-mysql.js",
    `-- Fecha: ${new Date().toISOString()}`,
    "SET NAMES utf8mb4;",
    "SET time_zone = '-05:00';",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "SET UNIQUE_CHECKS = 0;",
    "",
  );

  const { rows: columnasPg } = await pg.query(
    `SELECT table_name, column_name, data_type, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const porTabla = new Map();
  for (const c of columnasPg) {
    if (!porTabla.has(c.table_name)) porTabla.set(c.table_name, []);
    porTabla.get(c.table_name).push(c);
  }

  for (const tablaPg of porTabla.keys()) {
    if (!esquema.has(tablaPg)) avisos.push(`Tabla "${tablaPg}" existe en Supabase pero no en el esquema MySQL: se omite.`);
  }

  let totalFilas = 0;
  for (const [tabla, columnasMysql] of esquema) {
    if (tabla === "secuencias") continue;
    const cols = (porTabla.get(tabla) || []).filter((c) => c.is_generated !== "ALWAYS");
    if (cols.length === 0) {
      avisos.push(`Tabla "${tabla}" no existe en Supabase: queda vacía.`);
      continue;
    }
    const faltantes = cols.filter((c) => !columnasMysql.includes(c.column_name));
    for (const c of faltantes) avisos.push(`Columna ${tabla}.${c.column_name} no existe en MySQL: se omite.`);
    const usadas = cols.filter((c) => columnasMysql.includes(c.column_name));

    // ORDER BY ctid = orden físico (≈ orden de inserción) de Postgres.
    const { rows } = await pg.query(`SELECT ${usadas.map((c) => `"${c.column_name}"`).join(", ")} FROM "${tabla}" ORDER BY ctid`);
    salida.push(`-- ${tabla}: ${rows.length} filas`);
    // Vacía la tabla primero (el esquema trae filas semilla: modulos,
    // velas_parametros, concreto_parametros).
    salida.push(`DELETE FROM ${tabla};`);
    for (let i = 0; i < rows.length; i += FILAS_POR_INSERT) {
      const lote = rows.slice(i, i + FILAS_POR_INSERT);
      const valores = lote.map((fila) => `(${usadas.map((c) => valorSql(fila[c.column_name], c.data_type)).join(", ")})`);
      salida.push(`INSERT INTO ${tabla} (${usadas.map((c) => c.column_name).join(", ")}) VALUES\n${valores.join(",\n")};`);
    }
    salida.push("");
    totalFilas += rows.length;
    console.log(`  ${tabla.padEnd(32)} ${rows.length} filas`);
  }

  // Columnas SERIAL/IDENTITY → AUTO_INCREMENT: que el siguiente id (y el
  // número de cotización) siga donde iba en Postgres, no en MAX(id) + 1.
  for (const [tabla] of esquema) {
    for (const c of porTabla.get(tabla) || []) {
      const { rows } = await pg.query(`SELECT pg_get_serial_sequence($1, $2) AS secuencia`, [`public.${tabla}`, c.column_name]);
      if (!rows[0].secuencia) continue;
      const { rows: s } = await pg.query(`SELECT last_value, is_called FROM ${rows[0].secuencia}`);
      const siguiente = s[0].is_called ? Number(s[0].last_value) + 1 : Number(s[0].last_value);
      salida.push(`ALTER TABLE ${tabla} AUTO_INCREMENT = ${siguiente};`);
    }
  }

  // Secuencias: el siguiente número de comensal / factura sigue donde iba.
  for (const secuencia of ["comensal_seq", "facturas_numero_seq"]) {
    const { rows } = await pg.query(`SELECT last_value, is_called FROM ${secuencia}`);
    const valor = rows[0].is_called ? Number(rows[0].last_value) : Number(rows[0].last_value) - 1;
    salida.push(`UPDATE secuencias SET valor = ${valor} WHERE nombre = '${secuencia}';`);
  }

  salida.push("", "SET UNIQUE_CHECKS = 1;", "SET FOREIGN_KEY_CHECKS = 1;", "");
  fs.writeFileSync(SALIDA, salida.join("\n"), "utf8");

  console.log(`\n✔ ${totalFilas} filas escritas en ${path.relative(process.cwd(), SALIDA)}`);
  if (avisos.length) {
    console.log("\nAvisos:");
    for (const a of avisos) console.log("  - " + a);
  }
  await pg.end();
}

main().catch(async (err) => {
  console.error("\n✘ Error en la migración:", err.message);
  await pg.end().catch(() => {});
  process.exit(1);
});
