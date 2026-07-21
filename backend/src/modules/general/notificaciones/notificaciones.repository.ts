import { pool } from "../../../shared/db/pool";

export interface PushSuscripcion {
  id: number;
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function upsertSuscripcion(params: {
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  await pool.query(
    `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent`,
    [params.usuarioId, params.endpoint, params.p256dh, params.auth, params.userAgent ?? null],
  );
}

export async function borrarSuscripcionPorEndpoint(usuarioId: string, endpoint: string) {
  await pool.query(`DELETE FROM push_subscriptions WHERE usuario_id = $1 AND endpoint = $2`, [usuarioId, endpoint]);
}

export async function borrarSuscripcionVencida(endpoint: string) {
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

function mapSuscripcion(row: any): PushSuscripcion {
  return { id: row.id, usuarioId: row.usuario_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

/** Todas las suscripciones de los usuarios que tienen el rol indicado (ej.
 *  "Cocina") — para avisar a todo el que esté trabajando ese puesto, no solo
 *  a quien registró la acción. */
export async function listSuscripcionesPorRol(rolNombre: string): Promise<PushSuscripcion[]> {
  const result = await pool.query(
    `SELECT ps.* FROM push_subscriptions ps
       JOIN usuarios u ON u.id = ps.usuario_id
       JOIN roles r ON r.id = u.rol_id
      WHERE r.nombre = $1`,
    [rolNombre],
  );
  return result.rows.map(mapSuscripcion);
}

export async function listSuscripcionesPorUsuario(usuarioId: string): Promise<PushSuscripcion[]> {
  const result = await pool.query(`SELECT * FROM push_subscriptions WHERE usuario_id = $1`, [usuarioId]);
  return result.rows.map(mapSuscripcion);
}
