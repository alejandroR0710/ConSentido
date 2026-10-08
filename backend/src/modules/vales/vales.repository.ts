import { Pool, PoolClient, pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

const SELECT_VALE = `
  SELECT v.*, d.nombre AS destinatario_usuario_nombre, du.nombre AS dueno_nombre, c.nombre AS creado_por_nombre
    FROM vales v
    LEFT JOIN usuarios d ON d.id = v.destinatario_usuario_id
    LEFT JOIN usuarios du ON du.id = v.dueno_id
    LEFT JOIN usuarios c ON c.id = v.creado_por_id
`;

export interface FiltrosListarVales {
  tipo?: "pago" | "deuda";
  fuente?: string;
  estado?: "activo" | "resuelto" | "anulado";
}

export async function listVales(filtros: FiltrosListarVales) {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtros.tipo) {
    condiciones.push(`v.tipo = $${params.length + 1}`);
    params.push(filtros.tipo);
  }
  if (filtros.fuente) {
    condiciones.push(`v.fuente = $${params.length + 1}`);
    params.push(filtros.fuente);
  }
  if (filtros.estado === "anulado") {
    condiciones.push(`v.anulado_en IS NOT NULL`);
  } else if (filtros.estado === "resuelto") {
    condiciones.push(`(v.repuesto_en IS NOT NULL OR v.cobrado_en IS NOT NULL) AND v.anulado_en IS NULL`);
  } else if (filtros.estado === "activo") {
    condiciones.push(`v.repuesto_en IS NULL AND v.cobrado_en IS NULL AND v.anulado_en IS NULL`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(`${SELECT_VALE} ${where} ORDER BY v.created_at DESC`, params);
  return result.rows;
}

export async function getValeById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_VALE} WHERE v.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

/** Misma fila, bloqueada (FOR UPDATE) hasta el COMMIT — para reponer/anular
 *  sin que dos requests simultáneos lean el mismo estado de partida. */
export async function getValeParaActualizar(client: PoolClient, id: string) {
  const result = await client.query(`SELECT * FROM vales WHERE id = $1 FOR UPDATE`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function getCategoriaGastoPorNombre(nombre: string, executor: Executor = pool) {
  const result = await executor.query(`SELECT id FROM categorias_gasto WHERE nombre = $1`, [nombre]);
  return result.rowCount ? (result.rows[0].id as number) : null;
}

export async function crearVale(
  client: PoolClient,
  params: {
    tipo: string;
    pagadoA: string;
    destinatarioUsuarioId: string | null;
    destinatarioDocumento: string | null;
    concepto: string;
    montoEfectivo: number;
    montoBanco: number;
    montoAdeudado: number | null;
    fuente: string | null;
    duenoId: string | null;
    creadoPorId: string;
  },
) {
  const result = await client.query(
    `INSERT INTO vales (
       numero, tipo, pagado_a, destinatario_usuario_id, destinatario_documento, concepto,
       monto_efectivo, monto_banco, monto_adeudado, fuente, dueno_id, creado_por_id
     ) VALUES (
       'V-' || lpad(nextval('vales_numero_seq'), 6, '0'),
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )
     RETURNING *`,
    [
      params.tipo,
      params.pagadoA,
      params.destinatarioUsuarioId,
      params.destinatarioDocumento,
      params.concepto,
      params.montoEfectivo,
      params.montoBanco,
      params.montoAdeudado,
      params.fuente,
      params.duenoId,
      params.creadoPorId,
    ],
  );
  return result.rows[0];
}

export async function marcarRepuesto(client: PoolClient, id: string, fuenteReposicion: string) {
  await client.query(`UPDATE vales SET repuesto_en = NOW(), fuente_reposicion = $2 WHERE id = $1`, [
    id,
    fuenteReposicion,
  ]);
}

export async function marcarCobrado(client: PoolClient, id: string, montoEfectivo: number, montoBanco: number) {
  await client.query(
    `UPDATE vales SET cobrado_en = NOW(), monto_cobrado_efectivo = $2, monto_cobrado_banco = $3 WHERE id = $1`,
    [id, montoEfectivo, montoBanco],
  );
}

export async function marcarAnulado(client: PoolClient, id: string) {
  await client.query(`UPDATE vales SET anulado_en = NOW() WHERE id = $1`, [id]);
}
