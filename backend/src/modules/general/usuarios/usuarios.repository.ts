import { pool } from "../../../shared/db/pool";

export interface UsuarioListado {
  id: string;
  nombre: string;
  email: string;
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
    `SELECT u.id, u.nombre, u.email, u.rol_id, r.nombre AS rol_nombre, u.activo, u.ultimo_login, u.created_at
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      ORDER BY u.nombre ASC`,
  );
  return result.rows;
}

export async function getUsuarioById(id: string): Promise<UsuarioListado | null> {
  const result = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.rol_id, r.nombre AS rol_nombre, u.activo, u.ultimo_login, u.created_at
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
  email: string;
  passwordHash: string;
  rolId: number;
}): Promise<UsuarioListado> {
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, email, rol_id, activo, ultimo_login, created_at`,
    [params.nombre, params.email, params.passwordHash, params.rolId],
  );
  const rol = await getRolById(params.rolId);
  return { ...result.rows[0], rol_nombre: rol!.nombre };
}

export async function actualizarUsuario(
  id: string,
  params: {
    nombre?: string;
    email?: string;
    passwordHash?: string;
    rolId?: number;
    activo?: boolean;
  },
): Promise<UsuarioListado | null> {
  const result = await pool.query(
    `UPDATE usuarios
        SET nombre = COALESCE($2, nombre),
            email = COALESCE($3, email),
            password_hash = COALESCE($4, password_hash),
            rol_id = COALESCE($5, rol_id),
            activo = COALESCE($6, activo)
      WHERE id = $1
      RETURNING id`,
    [id, params.nombre ?? null, params.email ?? null, params.passwordHash ?? null, params.rolId ?? null, params.activo ?? null],
  );
  if (!result.rowCount) return null;
  return getUsuarioById(id);
}

/** Borrado físico — solo tiene éxito si el usuario nunca tuvo actividad (las FK
 *  sin ON DELETE CASCADE lo impiden con un 23503). Con historial, usar "Desactivar". */
export async function eliminarUsuario(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM usuarios WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
