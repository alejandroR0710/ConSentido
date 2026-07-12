import { pool } from "../db/pool";
import { Errors } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";

/**
 * Exige que el rol del usuario autenticado tenga el permiso indicado.
 * El permiso se valida contra roles_permisos/permisos en cada request:
 * revocar un permiso a un rol aplica de inmediato, sin reemitir tokens.
 */
export function requirePermission(codigo: string) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) {
      throw Errors.unauthorized();
    }

    const result = await pool.query(
      `SELECT 1
         FROM roles_permisos rp
         JOIN permisos p ON p.id = rp.permiso_id
        WHERE rp.rol_id = $1 AND p.codigo = $2
        LIMIT 1`,
      [req.auth.rolId, codigo],
    );

    if (result.rowCount === 0) {
      throw Errors.forbidden(`No tiene el permiso requerido: ${codigo}`);
    }

    next();
  });
}
