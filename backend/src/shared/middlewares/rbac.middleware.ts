import { pool } from "../db/pool";
import { Errors } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";

/**
 * Consulta directa contra roles_permisos/permisos, para casos donde un
 * service necesita validar un permiso ADICIONAL a mitad de una acción que ya
 * pasó el `requirePermission` de la ruta (ej. cerrar una orden es una ruta
 * compartida por Cajero/Root/Super Root, pero solo estos últimos pueden usar
 * el método "administrativo" dentro de ese mismo flujo).
 */
export async function tienePermiso(rolId: number, codigo: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM roles_permisos rp
       JOIN permisos p ON p.id = rp.permiso_id
      WHERE rp.rol_id = $1 AND p.codigo = $2
      LIMIT 1`,
    [rolId, codigo],
  );
  return result.rowCount! > 0;
}

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

    if (!(await tienePermiso(req.auth.rolId, codigo))) {
      throw Errors.forbidden(`No tiene el permiso requerido: ${codigo}`);
    }

    next();
  });
}
