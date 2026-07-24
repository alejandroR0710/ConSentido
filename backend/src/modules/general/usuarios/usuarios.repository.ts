import { pool } from "../../../shared/db/pool";

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string | null;
  numero_documento: string | null;
  rol_id: number;
  rol_nombre: string;
  activo: boolean;
  ultimo_login: string | null;
  created_at: string;
}

export interface Rol {
  id: number;
  nombre: string;
}

export async function listUsuarios(): Promise<UsuarioListado[]> {
  const result = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.numero_documento, u.rol_id, r.nombre AS rol_nombre, u.activo, u.ultimo_login, u.created_at
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      ORDER BY u.nombre ASC`,
  );
  return result.rows;
}

export async function getUsuarioById(id: string): Promise<UsuarioListado | null> {
  const result = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.numero_documento, u.rol_id, r.nombre AS rol_nombre, u.activo, u.ultimo_login, u.created_at
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.id = $1`,
    [id],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function getRolById(id: number): Promise<Rol | null> {
  const result = await pool.query(`SELECT id, nombre FROM roles WHERE id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function listRoles(): Promise<Rol[]> {
  const result = await pool.query(`SELECT id, nombre FROM roles ORDER BY id ASC`);
  return result.rows;
}

export async function crearUsuario(params: {
  nombre: string;
  email: string | null;
  numeroDocumento: string | null;
  passwordHash: string;
  rolId: number;
}): Promise<UsuarioListado> {
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, numero_documento, password_hash, rol_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nombre, email, numero_documento, rol_id, activo, ultimo_login, created_at`,
    [params.nombre, params.email, params.numeroDocumento, params.passwordHash, params.rolId],
  );
  const rol = await getRolById(params.rolId);
  return { ...result.rows[0], rol_nombre: rol!.nombre };
}

/**
 * SET dinámico: nombre/password/rol/activo son independientes (COALESCE de
 * toda la vida), pero el identificador es un par atado — cambiarlo significa
 * llenar UNA columna y limpiar la otra a la vez, algo que COALESCE no puede
 * expresar (nunca podría poner algo en null a propósito).
 */
export async function actualizarUsuario(
  id: string,
  params: {
    nombre?: string;
    passwordHash?: string;
    rolId?: number;
    activo?: boolean;
    identificador?: { tipo: "email" | "documento"; valor: string };
  },
): Promise<UsuarioListado | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  function agregar(columna: string, valor: unknown) {
    values.push(valor);
    sets.push(`${columna} = $${values.length}`);
  }

  if (params.nombre !== undefined) agregar("nombre", params.nombre);
  if (params.passwordHash !== undefined) agregar("password_hash", params.passwordHash);
  if (params.rolId !== undefined) agregar("rol_id", params.rolId);
  if (params.activo !== undefined) agregar("activo", params.activo);
  if (params.identificador) {
    agregar("email", params.identificador.tipo === "email" ? params.identificador.valor : null);
    agregar("numero_documento", params.identificador.tipo === "documento" ? params.identificador.valor : null);
  }

  if (sets.length === 0) return getUsuarioById(id);

  const result = await pool.query(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, values);
  if (!result.rowCount) return null;
  return getUsuarioById(id);
}

/** Borrado físico — solo tiene éxito si el usuario nunca tuvo actividad (las FK
 *  sin ON DELETE CASCADE lo impiden con un 23503). Con historial, usar "Desactivar". */
export async function eliminarUsuario(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
