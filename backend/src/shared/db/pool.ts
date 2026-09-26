import { randomUUID } from "crypto";
import mysql from "mysql2/promise";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

// Conexión: DATABASE_URL (mysql://usuario:clave@host:3306/base) o, más
// cómodo en cPanel cuando la clave tiene símbolos (@, #, /...) que habría
// que codificar en una URL, los campos sueltos DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.
const conexion = process.env.DB_HOST
  ? {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    }
  : { uri: process.env.DATABASE_URL };

if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
  throw new Error("Falta la conexión a MySQL (DATABASE_URL o DB_HOST/DB_USER/DB_PASSWORD/DB_NAME). Ver .env.example.");
}

// ============================================================================
// Capa de compatibilidad PostgreSQL → MySQL 8 (rama hosting-mysql).
//
// Todo el backend se escribió contra node-postgres (`pool.query(sql, [..])`
// con placeholders $1, `RETURNING`, `ON CONFLICT`, `nextval()`...). En vez de
// reescribir cada repositorio, este módulo expone la MISMA forma de API
// (`pool.query`, `pool.connect()` → `client.query/release`, resultado
// `{ rows, rowCount }`) sobre mysql2, y traduce al vuelo lo que es mecánico:
//
//   - `$1, $2...`         → valores escapados en el lugar (se pueden repetir).
//   - `now()`             → NOW(6) (precisión de microsegundos, como Postgres).
//   - `nextval('x_seq')`  → siguiente valor de la tabla `secuencias`.
//   - `... RETURNING cols` en INSERT/UPDATE/DELETE → se emula con SELECTs
//     por llave primaria en la misma conexión (y transacción).
//   - `ON CONFLICT (cols) DO UPDATE SET c = EXCLUDED.c` / `DO NOTHING`
//     → `ON DUPLICATE KEY UPDATE c = VALUES(c)`.
//   - Códigos de error MySQL → códigos SQLSTATE de Postgres (23505, 23503...)
//     para que los `catch` existentes sigan funcionando.
//
// Lo que NO es mecánico (casts `::`, FILTER, AT TIME ZONE, json_agg...) se
// reescribió a mano en cada consulta.
//
// Zona horaria: Colombia no tiene horario de verano, así que la sesión MySQL
// trabaja fijo en -05:00 — NOW(), CURDATE(), DATE(col) y DATE_FORMAT(col)
// quedan en hora de Bogotá, igual que antes hacía `TimeZone=America/Bogota`
// en Postgres. Las columnas DATETIME guardan hora de Bogotá.
// ============================================================================

const ZONA_HORARIA = "-05:00";

const SQL_MODE = [
  "STRICT_TRANS_TABLES",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
  // `'F-' || lpad(...)` concatena como en Postgres (sin esto `||` es OR).
  "PIPES_AS_CONCAT",
  // "identificador" entre comillas dobles, como en Postgres.
  "ANSI_QUOTES",
].join(",");

const mysqlPool = mysql.createPool({
  ...conexion,
  timezone: ZONA_HORARIA,
  // DATE llega como 'YYYY-MM-DD' (texto), no como Date a medianoche local.
  dateStrings: ["DATE"],
  // BIGINT/COUNT(*) llegan como texto, igual que node-postgres con int8.
  supportBigNumbers: true,
  bigNumberStrings: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  waitForConnections: true,
  // BOOLEAN en MySQL es TINYINT(1): se devuelve true/false como en Postgres.
  // Las expresiones booleanas (`EXISTS (...) AS x`, `a < b AS x`) llegan como
  // INT/BIGINT de largo 1 (una columna INT mide 11 y un COUNT(*) 21): también
  // se pasan a true/false.
  typeCast(field, next) {
    if (["TINY", "LONG", "LONGLONG"].includes(field.type) && field.length === 1) {
      const valor = field.string();
      return valor === null ? null : valor === "1";
    }
    return next();
  },
});

mysqlPool.pool.on("connection", (conn) => {
  // group_concat_max_len: GROUP_CONCAT arma arreglos JSON (reemplazo de
  // json_agg) y por defecto se corta en 1024 caracteres.
  conn.query(
    `SET time_zone = '${ZONA_HORARIA}', sql_mode = '${SQL_MODE}', group_concat_max_len = 16777216`,
  );
});

export interface QueryResult<R = any> {
  rows: R[];
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Escaneo de SQL respetando literales ('...'), identificadores ("...") y
// comentarios — todo lo que se reescribe (placeholders, palabras clave) solo
// se toca FUERA de ellos.
// ---------------------------------------------------------------------------

interface Segmento {
  texto: string;
  literal: boolean;
}

function segmentar(sql: string): Segmento[] {
  const segmentos: Segmento[] = [];
  let actual = "";
  let i = 0;
  const cerrarCodigo = () => {
    if (actual) segmentos.push({ texto: actual, literal: false });
    actual = "";
  };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      cerrarCodigo();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      segmentos.push({ texto: sql.slice(i, j + 1), literal: true });
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      cerrarCodigo();
      const fin = sql.indexOf("\n", i);
      const j = fin === -1 ? sql.length : fin;
      segmentos.push({ texto: sql.slice(i, j), literal: true });
      i = j;
    } else if (c === "/" && sql[i + 1] === "*") {
      cerrarCodigo();
      const fin = sql.indexOf("*/", i + 2);
      const j = fin === -1 ? sql.length : fin + 2;
      segmentos.push({ texto: sql.slice(i, j), literal: true });
      i = j;
    } else {
      actual += c;
      i++;
    }
  }
  cerrarCodigo();
  return segmentos;
}

/** Aplica `fn` solo a las partes de código (fuera de literales/comentarios). */
function reemplazarEnCodigo(sql: string, fn: (codigo: string) => string): string {
  return segmentar(sql)
    .map((s) => (s.literal ? s.texto : fn(s.texto)))
    .join("");
}

/** Posiciones de `palabra` a profundidad 0 de paréntesis, fuera de literales. */
function posicionesNivelSuperior(sql: string, palabra: string): number[] {
  const posiciones: number[] = [];
  const re = new RegExp(`^${palabra}\\b`, "i");
  let profundidad = 0;
  let offset = 0;
  for (const seg of segmentar(sql)) {
    if (!seg.literal) {
      for (let k = 0; k < seg.texto.length; k++) {
        const c = seg.texto[k];
        if (c === "(") profundidad++;
        else if (c === ")") profundidad--;
        else if (
          profundidad === 0 &&
          (k === 0 ? true : !/[\w$.]/.test(seg.texto[k - 1])) &&
          re.test(seg.texto.slice(k))
        ) {
          posiciones.push(offset + k);
        }
      }
    }
    offset += seg.texto.length;
  }
  return posiciones;
}

/** Divide `a, b, (c, d)` por comas de nivel superior. */
function dividirPorComas(sql: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const seg of segmentar(sql)) {
    if (seg.literal) {
      actual += seg.texto;
      continue;
    }
    for (const c of seg.texto) {
      if (c === "(") profundidad++;
      if (c === ")") profundidad--;
      if (c === "," && profundidad === 0) {
        partes.push(actual.trim());
        actual = "";
      } else {
        actual += c;
      }
    }
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

/** Grupos `( ... )` de nivel superior a partir de `desde`: [inicio, fin] (fin = índice del ')'). */
function gruposParentesis(sql: string, desde: number, hasta = sql.length): [number, number][] {
  const grupos: [number, number][] = [];
  let profundidad = 0;
  let inicio = -1;
  let offset = 0;
  for (const seg of segmentar(sql)) {
    if (!seg.literal) {
      for (let k = 0; k < seg.texto.length; k++) {
        const pos = offset + k;
        if (pos < desde || pos >= hasta) continue;
        const c = seg.texto[k];
        if (c === "(") {
          if (profundidad === 0) inicio = pos;
          profundidad++;
        } else if (c === ")") {
          profundidad--;
          if (profundidad === 0) grupos.push([inicio, pos]);
        }
      }
    }
    offset += seg.texto.length;
  }
  return grupos;
}

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

function normalizarParametro(valor: unknown): unknown {
  if (valor === undefined) return null;
  if (
    valor !== null &&
    typeof valor === "object" &&
    !(valor instanceof Date) &&
    !Buffer.isBuffer(valor) &&
    !Array.isArray(valor)
  ) {
    // node-postgres serializa objetos a JSON (columnas JSONB); mysql2 los
    // convertiría en `clave = valor`.
    return JSON.stringify(valor);
  }
  return valor;
}

function escapar(valor: unknown): string {
  const v = normalizarParametro(valor);
  if (Array.isArray(v)) {
    // `= ANY($1)` ya se reescribió a `IN ($1)`; un arreglo vacío queda como
    // `IN (NULL)`, que no coincide con nada (igual que ANY('{}') en Postgres).
    if (v.length === 0) return "NULL";
    return v.map((x) => escapar(x)).join(", ");
  }
  return mysql.escape(v as Parameters<typeof mysql.escape>[0], false, ZONA_HORARIA);
}

/** $n → valor escapado, now() → NOW(6), = ANY($n) → IN ($n). */
function traducir(sql: string, params: unknown[]): string {
  return reemplazarEnCodigo(sql, (codigo) =>
    codigo
      .replace(/(<>|!=)\s*ALL\s*\(\s*(\$\d+)\s*\)/gi, "NOT IN ($2)")
      .replace(/=\s*ANY\s*\(\s*(\$\d+)\s*\)/gi, "IN ($1)")
      .replace(/\bnow\(\)/gi, "NOW(6)")
      // LIMIT/OFFSET exigen un entero literal en MySQL (LIMIT '20' falla).
      .replace(/\b(LIMIT|OFFSET)\s+\$(\d+)/gi, (_m, palabra: string, n: string) => {
        const valor = Math.trunc(Number(params[Number(n) - 1]));
        if (!Number.isFinite(valor)) throw new Error(`${palabra} inválido en la consulta`);
        return `${palabra} ${valor}`;
      })
      .replace(/\$(\d+)/g, (_m, n: string) => {
        const idx = Number(n) - 1;
        if (idx >= params.length) throw new Error(`Falta el parámetro $${n} en la consulta`);
        return escapar(params[idx]);
      }),
  );
}

// ---------------------------------------------------------------------------
// Errores: códigos MySQL → SQLSTATE de Postgres (lo que chequean los catch).
// ---------------------------------------------------------------------------

const CODIGOS_PG: Record<number, string> = {
  1062: "23505", // duplicado en UNIQUE
  1451: "23503", // no se puede borrar: FK que lo referencia
  1452: "23503", // FK inexistente
  1048: "23502", // NOT NULL
  3819: "23514", // CHECK
};

function adaptarError(err: unknown, sql: string): never {
  if (err && typeof err === "object" && "errno" in err) {
    const e = err as { errno: number; code?: string; mysqlCode?: string; sqlQuery?: string };
    const pg = CODIGOS_PG[e.errno];
    e.mysqlCode = e.code;
    if (pg) e.code = pg;
    if (!e.sqlQuery) e.sqlQuery = sql;
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Metadatos de llave primaria (para emular RETURNING)
// ---------------------------------------------------------------------------

interface LlavePrimaria {
  columnas: string[];
  autoIncremento: boolean;
}

const cacheLlaves = new Map<string, LlavePrimaria>();

async function llavePrimaria(conn: PoolConnection, tabla: string): Promise<LlavePrimaria> {
  const cacheada = cacheLlaves.get(tabla);
  if (cacheada) return cacheada;
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS columna, EXTRA AS extra
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'
      ORDER BY ORDINAL_POSITION`,
    [tabla],
  );
  if (filas.length === 0) throw new Error(`La tabla ${tabla} no tiene llave primaria (RETURNING)`);
  const llave: LlavePrimaria = {
    columnas: filas.map((f) => f.columna as string),
    autoIncremento: filas.some((f) => String(f.extra).includes("auto_increment")),
  };
  cacheLlaves.set(tabla, llave);
  return llave;
}

function condicionLlaves(llave: LlavePrimaria, filas: Record<string, unknown>[]): string {
  if (filas.length === 0) return "1 = 0";
  if (llave.columnas.length === 1) {
    const col = llave.columnas[0];
    return `${col} IN (${filas.map((f) => escapar(f[col])).join(", ")})`;
  }
  return `(${llave.columnas.join(", ")}) IN (${filas
    .map((f) => `(${llave.columnas.map((c) => escapar(f[c])).join(", ")})`)
    .join(", ")})`;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

async function ejecutarCrudo(conn: PoolConnection, sql: string): Promise<QueryResult> {
  try {
    const [resultado] = await conn.query(sql);
    if (Array.isArray(resultado)) {
      return { rows: resultado as any[], rowCount: resultado.length };
    }
    const cabecera = resultado as ResultSetHeader;
    return { rows: [], rowCount: cabecera.affectedRows, insertId: cabecera.insertId } as QueryResult & {
      insertId: number;
    };
  } catch (err) {
    adaptarError(err, sql);
  }
}

/** Reemplaza cada nextval('x') por el siguiente valor de la tabla `secuencias`. */
async function resolverNextval(conn: PoolConnection, sql: string): Promise<string> {
  const nombres: string[] = [];
  // nextval('x') queda partido en segmentos (código `nextval(` + literal
  // `'x'` + código `)`), así que se busca sobre el texto completo.
  const re = /nextval\(\s*'([a-z_]+)'\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) nombres.push(m[1]);
  if (nombres.length === 0) return sql;
  const valores: number[] = [];
  for (const nombre of nombres) {
    const r = await ejecutarCrudo(
      conn,
      `UPDATE secuencias SET valor = LAST_INSERT_ID(valor + 1) WHERE nombre = ${mysql.escape(nombre)}`,
    );
    if (r.rowCount === 0) throw new Error(`No existe la secuencia ${nombre}`);
    const [[fila]] = await conn.query<RowDataPacket[]>("SELECT LAST_INSERT_ID() AS valor");
    valores.push(Number(fila.valor));
  }
  let i = 0;
  return sql.replace(re, () => String(valores[i++]));
}

interface OnConflict {
  columnas: string[];
  predicado: string | null; // WHERE del índice parcial (ej. `zona_id IS NULL`)
  accion: "nada" | "actualizar";
  set: string;
}

/** Separa `... ON CONFLICT (...) [WHERE ...] DO UPDATE SET ... | DO NOTHING`. */
function extraerOnConflict(sql: string): { cuerpo: string; conflicto: OnConflict | null } {
  const pos = posicionesNivelSuperior(sql, "ON\\s+CONFLICT");
  if (pos.length === 0) return { cuerpo: sql, conflicto: null };
  const cuerpo = sql.slice(0, pos[0]);
  const resto = sql.slice(pos[0]);
  const m = /^ON\s+CONFLICT\s*(?:\(([^)]*)\))?\s*(?:WHERE\s+([\s\S]*?))?\s*DO\s+(NOTHING|UPDATE\s+SET\s+([\s\S]*))$/i.exec(
    resto.trim(),
  );
  if (!m) throw new Error(`ON CONFLICT no soportado: ${resto}`);
  return {
    cuerpo,
    conflicto: {
      columnas: m[1] ? m[1].split(",").map((c) => c.trim()) : [],
      predicado: m[2]?.trim() || null,
      accion: m[3].toUpperCase() === "NOTHING" ? "nada" : "actualizar",
      set: m[4] ?? "",
    },
  };
}

/** Punto único de ejecución: traduce y, si hace falta, emula RETURNING. */
async function ejecutar(conn: PoolConnection, sqlPg: string, params: unknown[], enTransaccion: boolean) {
  let sql = await resolverNextval(conn, sqlPg);

  const posReturning = posicionesNivelSuperior(sql, "RETURNING");
  const retorno = posReturning.length ? sql.slice(posReturning[posReturning.length - 1] + "RETURNING".length).trim() : null;
  if (retorno !== null) sql = sql.slice(0, posReturning[posReturning.length - 1]);

  const esInsert = /^\s*INSERT\b/i.test(sql);
  if (!esInsert && retorno === null) {
    return ejecutarCrudo(conn, traducir(sql, params));
  }

  // Las emulaciones hacen varios pasos: van dentro de una transacción para
  // que nadie vea (ni cambie) filas a mitad de camino.
  const propia = !enTransaccion && retorno !== null;
  if (propia) await conn.query("START TRANSACTION");
  try {
    let resultado: QueryResult;
    if (esInsert) resultado = await insertar(conn, sql, params, retorno);
    else if (/^\s*UPDATE\b/i.test(sql)) resultado = await actualizarOBorrar(conn, sql, params, retorno!, "UPDATE");
    else if (/^\s*DELETE\b/i.test(sql)) resultado = await actualizarOBorrar(conn, sql, params, retorno!, "DELETE");
    else throw new Error(`RETURNING no soportado en: ${sqlPg}`);
    if (propia) await conn.query("COMMIT");
    return resultado;
  } catch (err) {
    if (propia) await conn.query("ROLLBACK");
    throw err;
  }
}

async function insertar(
  conn: PoolConnection,
  sqlConConflicto: string,
  params: unknown[],
  retorno: string | null,
): Promise<QueryResult> {
  const { cuerpo, conflicto } = extraerOnConflict(sqlConConflicto);
  let sql = cuerpo;

  let sufijo = "";
  if (conflicto?.accion === "actualizar") {
    const set = reemplazarEnCodigo(conflicto.set, (c) => c.replace(/\bEXCLUDED\.(\w+)/gi, "VALUES($1)"));
    sufijo = ` ON DUPLICATE KEY UPDATE ${set}`;
  } else if (conflicto?.accion === "nada") {
    // DO NOTHING: asignación sin efecto sobre la primera columna insertada.
    const primera = /\(\s*([a-z_]+)/i.exec(sql)![1];
    sufijo = ` ON DUPLICATE KEY UPDATE ${primera} = ${primera}`;
  }

  if (retorno === null) {
    return ejecutarCrudo(conn, traducir(sql + sufijo, params));
  }

  const m = /^\s*INSERT\s+INTO\s+([a-z_]+)\s*\(/i.exec(sql);
  if (!m) throw new Error(`INSERT ... RETURNING no soportado: ${sql}`);
  const tabla = m[1];
  const llave = await llavePrimaria(conn, tabla);

  const [grupoColumnas] = gruposParentesis(sql, m[0].length - 1);
  const columnas = dividirPorComas(sql.slice(grupoColumnas[0] + 1, grupoColumnas[1])).map((c) => c.toLowerCase());
  const posValues = posicionesNivelSuperior(sql, "VALUES").find((p) => p > grupoColumnas[1]);
  if (posValues === undefined) throw new Error(`INSERT ... SELECT ... RETURNING no soportado: ${sql}`);
  let tuplas = gruposParentesis(sql, posValues);

  // Valores de cada fila (para recuperar la llave o las columnas del conflicto).
  const valorDe = (expr: string): unknown => {
    const p = /^\$(\d+)$/.exec(expr.trim());
    if (p) return normalizarParametro(params[Number(p[1]) - 1]);
    throw new Error(`No se puede resolver el valor "${expr}" para emular RETURNING`);
  };

  // Llave UUID no incluida en el INSERT: se genera acá y se inyecta.
  const idsGenerados: string[] = [];
  if (!llave.autoIncremento && llave.columnas.length === 1 && !columnas.includes(llave.columnas[0])) {
    const col = llave.columnas[0];
    let nuevo = sql;
    // De atrás hacia adelante para no mover las posiciones pendientes.
    for (const [inicio] of [...tuplas].reverse()) {
      const id = randomUUID();
      idsGenerados.unshift(id);
      nuevo = nuevo.slice(0, inicio + 1) + `'${id}', ` + nuevo.slice(inicio + 1);
    }
    nuevo = nuevo.slice(0, grupoColumnas[0] + 1) + `${col}, ` + nuevo.slice(grupoColumnas[0] + 1);
    sql = nuevo;
    columnas.unshift(col);
    tuplas = gruposParentesis(sql, posValues + `${col}, `.length);
  }

  const filasTuplas = tuplas.map(([ini, fin]) => dividirPorComas(sql.slice(ini + 1, fin)));
  const r = (await ejecutarCrudo(conn, traducir(sql + sufijo, params))) as QueryResult & { insertId: number };

  let condicion: string;
  if (conflicto) {
    // Tras un upsert la fila puede ser la que YA existía: se busca por las
    // columnas del conflicto (+ el predicado del índice parcial, si hay).
    const cols = conflicto.columnas.length ? conflicto.columnas : llave.columnas;
    const porFila = filasTuplas.map((valores) =>
      cols
        .map((c) => {
          const idx = columnas.indexOf(c.toLowerCase());
          const valor = valorDe(valores[idx]);
          return valor === null ? `${c} IS NULL` : `${c} = ${escapar(valor)}`;
        })
        .join(" AND "),
    );
    condicion = porFila.map((c) => `(${c})`).join(" OR ");
    if (conflicto.predicado) condicion = `(${condicion}) AND (${conflicto.predicado})`;
    if (conflicto.accion === "nada") {
      // DO NOTHING: solo se devuelven las filas realmente insertadas.
      if (idsGenerados.length) {
        condicion = `${llave.columnas[0]} IN (${idsGenerados.map((id) => `'${id}'`).join(", ")})`;
      } else if (r.rowCount === 0) {
        return { rows: [], rowCount: 0 };
      }
    }
  } else if (idsGenerados.length) {
    condicion = `${llave.columnas[0]} IN (${idsGenerados.map((id) => `'${id}'`).join(", ")})`;
  } else if (llave.autoIncremento) {
    const ids = Array.from({ length: tuplas.length }, (_, i) => r.insertId + i);
    condicion = `${llave.columnas[0]} IN (${ids.join(", ")})`;
  } else {
    condicion = condicionLlaves(
      llave,
      filasTuplas.map((valores) =>
        Object.fromEntries(llave.columnas.map((c) => [c, valorDe(valores[columnas.indexOf(c.toLowerCase())])])),
      ),
    );
  }

  const filas = await ejecutarCrudo(conn, `SELECT ${retorno} FROM ${tabla} WHERE ${condicion}`);
  return { rows: filas.rows, rowCount: filas.rows.length };
}

async function actualizarOBorrar(
  conn: PoolConnection,
  sql: string,
  params: unknown[],
  retorno: string,
  tipo: "UPDATE" | "DELETE",
): Promise<QueryResult> {
  const m =
    tipo === "UPDATE"
      ? /^\s*UPDATE\s+([a-z_]+)(?:\s+(?:AS\s+)?(?!SET\b)([a-z_]+))?\s+SET\b/i.exec(sql)
      : /^\s*DELETE\s+FROM\s+([a-z_]+)(?:\s+(?:AS\s+)?(?!WHERE\b)([a-z_]+))?\s+WHERE\b/i.exec(sql);
  if (!m) throw new Error(`${tipo} ... RETURNING no soportado: ${sql}`);
  const tabla = m[1];
  const alias = m[2] ?? tabla;
  if (tipo === "UPDATE" && posicionesNivelSuperior(sql, "FROM").length > 0) {
    throw new Error(`UPDATE ... FROM (sintaxis de Postgres) no existe en MySQL: ${sql}`);
  }
  const posWhere = posicionesNivelSuperior(sql, "WHERE");
  if (posWhere.length === 0) throw new Error(`${tipo} ... RETURNING sin WHERE no soportado: ${sql}`);
  const where = sql.slice(posWhere[posWhere.length - 1]);
  const llave = await llavePrimaria(conn, tabla);

  const cols = llave.columnas.map((c) => `${alias}.${c}`).join(", ");
  const antes = await ejecutarCrudo(conn, traducir(`SELECT ${cols}, ${tipo === "DELETE" ? retorno : "1"} FROM ${tabla} ${alias} ${where} FOR UPDATE`, params));
  if (antes.rows.length === 0) return { rows: [], rowCount: 0 };

  if (tipo === "DELETE") {
    await ejecutarCrudo(conn, traducir(sql, params));
    return { rows: antes.rows.map((f) => filtrarLlaveExtra(f, retorno, llave)), rowCount: antes.rows.length };
  }

  const r = await ejecutarCrudo(conn, traducir(sql, params));
  const despues = await ejecutarCrudo(conn, `SELECT ${retorno} FROM ${tabla} WHERE ${condicionLlaves(llave, antes.rows)}`);
  return { rows: despues.rows, rowCount: r.rowCount };
}

/** En DELETE ... RETURNING cols se pidieron también las llaves; si no
 *  estaban en `cols`, se quitan para devolver exactamente lo pedido. */
function filtrarLlaveExtra(fila: Record<string, unknown>, retorno: string, llave: LlavePrimaria) {
  if (retorno.trim() === "*") return fila;
  const pedidas = dividirPorComas(retorno).map((c) => c.split(/\s+AS\s+|\./i).pop()!.trim().toLowerCase());
  const copia = { ...fila };
  for (const c of llave.columnas) if (!pedidas.includes(c.toLowerCase())) delete copia[c];
  return copia;
}

// ---------------------------------------------------------------------------
// API estilo node-postgres
// ---------------------------------------------------------------------------

export class PoolClient {
  private enTransaccion = false;

  constructor(private readonly conn: PoolConnection) {}

  async query<R = any>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
    const comando = sql.trim().toUpperCase();
    if (comando === "BEGIN" || comando === "START TRANSACTION") {
      await this.conn.query("START TRANSACTION");
      this.enTransaccion = true;
      return { rows: [], rowCount: 0 };
    }
    if (comando === "COMMIT" || comando === "ROLLBACK") {
      this.enTransaccion = false;
      await this.conn.query(comando);
      return { rows: [], rowCount: 0 };
    }
    return ejecutar(this.conn, sql, params, this.enTransaccion);
  }

  release() {
    if (this.enTransaccion) {
      // Nunca devolver al pool una conexión con una transacción abierta.
      this.conn.query("ROLLBACK").finally(() => this.conn.release());
      this.enTransaccion = false;
      return;
    }
    this.conn.release();
  }
}

export class Pool {
  async query<R = any>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
    const conn = await mysqlPool.getConnection();
    try {
      return await ejecutar(conn, sql, params, false);
    } finally {
      conn.release();
    }
  }

  async connect(): Promise<PoolClient> {
    return new PoolClient(await mysqlPool.getConnection());
  }

  on(_evento: "error", _fn: (err: Error) => void) {
    // mysql2 reporta los errores por consulta; se mantiene por compatibilidad.
  }

  end() {
    return mysqlPool.end();
  }
}

export const pool = new Pool();
