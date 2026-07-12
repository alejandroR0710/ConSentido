import { Request } from "express";
import { pool } from "../db/pool";

interface AuditParams {
  req: Request;
  accion: string;
  entidad: string;
  entidadId: string;
  detalle?: Record<string, unknown>;
}

/** Registra una acción en auditoria. Se llama explícitamente desde los services tras una escritura exitosa. */
export async function registrarAuditoria({ req, accion, entidad, entidadId, detalle }: AuditParams) {
  await pool.query(
    `INSERT INTO auditoria (usuario_id, modulo_id, accion, entidad, entidad_id, detalle, ip)
     VALUES ($1, NULL, $2, $3, $4, $5, $6)`,
    [req.auth?.usuarioId ?? null, accion, entidad, entidadId, detalle ? JSON.stringify(detalle) : null, req.ip],
  );
}
