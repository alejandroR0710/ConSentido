import { pool } from "../../../shared/db/pool";

export interface UsuarioAuth {
  id: string;
  nombre: string;
  email: string;
  passwordHash: string;
  rolId: number;
  rolNombre: string;
  activo: boolean;
}

export async function findUsuarioByEmail(email: string): Promise<UsuarioAuth | null> {
  const result = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol_id, u.activo, r.nombre AS rol_nombre
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.email = $1`,
    [email],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    passwordHash: row.password_hash,
    rolId: row.rol_id,
    rolNombre: row.rol_nombre,
    activo: row.activo,
  };
}

export async function findUsuarioById(id: string): Promise<UsuarioAuth | null> {
  const result = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol_id, u.activo, r.nombre AS rol_nombre
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.id = $1`,
    [id],
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    passwordHash: row.password_hash,
    rolId: row.rol_id,
    rolNombre: row.rol_nombre,
    activo: row.activo,
  };
}

/** Módulos accesibles: unión de acceso explícito (usuarios_modulos) con los permisos del rol. */
export async function findModulosPermitidos(usuarioId: string, rolId: number): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT m.slug
       FROM modulos m
       LEFT JOIN usuarios_modulos um ON um.modulo_id = m.id AND um.usuario_id = $1
       LEFT JOIN permisos p ON p.modulo_id = m.id
       LEFT JOIN roles_permisos rp ON rp.permiso_id = p.id AND rp.rol_id = $2
      WHERE um.usuario_id IS NOT NULL OR rp.rol_id IS NOT NULL`,
    [usuarioId, rolId],
  );
  return result.rows.map((r) => r.slug as string);
}

export async function updateUltimoLogin(usuarioId: string): Promise<void> {
  await pool.query(`UPDATE usuarios SET ultimo_login = now() WHERE id = $1`, [usuarioId]);
}
