import { PoolClient } from "pg";
import { pool } from "../../shared/db/pool";
import { ActualizarInsumoInput, CrearInsumoInput } from "./insumos.schema";

export interface Insumo {
  id: string;
  nombre: string;
  categoriaId: number | null;
  unidadMedida: string;
  stockMinimo: string;
  costoUnitario: string;
  proveedorPrincipalId: string | null;
  imagenUrl: string | null;
  descripcion: string | null;
  activo: boolean;
}

const COLUMNAS = `id, nombre, categoria_id, unidad_medida, stock_minimo, costo_unitario, proveedor_principal_id, imagen_url, descripcion, activo`;

function mapInsumo(row: any): Insumo {
  return {
    id: row.id,
    nombre: row.nombre,
    categoriaId: row.categoria_id,
    unidadMedida: row.unidad_medida,
    stockMinimo: row.stock_minimo,
    costoUnitario: row.costo_unitario,
    proveedorPrincipalId: row.proveedor_principal_id,
    imagenUrl: row.imagen_url,
    descripcion: row.descripcion,
    activo: row.activo,
  };
}

export async function listInsumos(): Promise<Insumo[]> {
  const result = await pool.query(
    `SELECT ${COLUMNAS} FROM insumos WHERE activo = true ORDER BY nombre ASC`,
  );
  return result.rows.map(mapInsumo);
}

/** Listado completo (activos e inactivos) para la pantalla de administración. */
export async function listInsumosAdmin(): Promise<Insumo[]> {
  const result = await pool.query(`SELECT ${COLUMNAS} FROM insumos ORDER BY nombre ASC`);
  return result.rows.map(mapInsumo);
}

export async function getInsumoById(id: string): Promise<Insumo | null> {
  const result = await pool.query(`SELECT ${COLUMNAS} FROM insumos WHERE id = $1`, [id]);
  return result.rowCount ? mapInsumo(result.rows[0]) : null;
}

export async function createInsumo(data: CrearInsumoInput): Promise<Insumo> {
  const result = await pool.query(
    `INSERT INTO insumos (nombre, categoria_id, unidad_medida, stock_minimo, costo_unitario, proveedor_principal_id, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNAS}`,
    [
      data.nombre,
      data.categoriaId ?? null,
      data.unidadMedida,
      data.stockMinimo,
      data.costoUnitario,
      data.proveedorPrincipalId ?? null,
      data.descripcion ?? null,
    ],
  );
  return mapInsumo(result.rows[0]);
}

export async function updateInsumo(id: string, data: ActualizarInsumoInput): Promise<Insumo | null> {
  const result = await pool.query(
    `UPDATE insumos SET
       nombre = COALESCE($2, nombre),
       categoria_id = COALESCE($3, categoria_id),
       unidad_medida = COALESCE($4, unidad_medida),
       stock_minimo = COALESCE($5, stock_minimo),
       costo_unitario = COALESCE($6, costo_unitario),
       proveedor_principal_id = COALESCE($7, proveedor_principal_id),
       descripcion = COALESCE($8, descripcion),
       activo = COALESCE($9, activo)
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [
      id,
      data.nombre ?? null,
      data.categoriaId ?? null,
      data.unidadMedida ?? null,
      data.stockMinimo ?? null,
      data.costoUnitario ?? null,
      data.proveedorPrincipalId ?? null,
      data.descripcion ?? null,
      data.activo ?? null,
    ],
  );
  return result.rowCount ? mapInsumo(result.rows[0]) : null;
}

export async function actualizarImagenInsumo(id: string, imagenUrl: string): Promise<Insumo | null> {
  const result = await pool.query(`UPDATE insumos SET imagen_url = $2 WHERE id = $1 RETURNING ${COLUMNAS}`, [
    id,
    imagenUrl,
  ]);
  return result.rowCount ? mapInsumo(result.rows[0]) : null;
}

export async function listAlmacenes() {
  const result = await pool.query(
    `SELECT id, nombre, modulo_id, ubicacion FROM almacenes WHERE activo = true ORDER BY nombre ASC`,
  );
  return result.rows;
}

export async function getStock(client: PoolClient, insumoId: string, almacenId: number): Promise<number> {
  const result = await client.query(
    `SELECT cantidad_actual FROM inventario_insumos WHERE insumo_id = $1 AND almacen_id = $2 FOR UPDATE`,
    [insumoId, almacenId],
  );
  return result.rowCount ? Number(result.rows[0].cantidad_actual) : 0;
}

export async function ajustarStock(
  client: PoolClient,
  insumoId: string,
  almacenId: number,
  delta: number,
): Promise<number> {
  const result = await client.query(
    `INSERT INTO inventario_insumos (insumo_id, almacen_id, cantidad_actual, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (insumo_id, almacen_id)
     DO UPDATE SET cantidad_actual = inventario_insumos.cantidad_actual + $3, updated_at = now()
     RETURNING cantidad_actual`,
    [insumoId, almacenId, delta],
  );
  return Number(result.rows[0].cantidad_actual);
}

export async function insertMovimiento(
  client: PoolClient,
  params: {
    insumoId: string;
    almacenId: number;
    tipo: string;
    cantidad: number;
    costoUnitario?: number;
    motivo?: string;
    almacenDestinoId?: number;
    proveedorId?: string;
    usuarioId?: string;
  },
) {
  await client.query(
    `INSERT INTO movimientos_insumo
       (insumo_id, almacen_id, tipo, cantidad, costo_unitario, motivo, modulo_origen_id,
        referencia_entidad, referencia_id, almacen_destino_id, proveedor_id, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6,
             (SELECT id FROM modulos WHERE slug = 'insumos'),
             'movimientos_insumo', NULL, $7, $8, $9)`,
    [
      params.insumoId,
      params.almacenId,
      params.tipo,
      params.cantidad,
      params.costoUnitario ?? null,
      params.motivo ?? null,
      params.almacenDestinoId ?? null,
      params.proveedorId ?? null,
      params.usuarioId ?? null,
    ],
  );
}

export async function getStockMinimo(client: PoolClient, insumoId: string): Promise<number> {
  const result = await client.query(`SELECT stock_minimo FROM insumos WHERE id = $1`, [insumoId]);
  return Number(result.rows[0]?.stock_minimo ?? 0);
}

export async function crearAlertaStockMinimo(
  client: PoolClient,
  insumoId: string,
  nombreInsumo: string,
  cantidadActual: number,
) {
  await client.query(
    `INSERT INTO alertas (tipo, modulo_id, entidad, entidad_id, mensaje, severidad)
     VALUES ('stock_minimo', (SELECT id FROM modulos WHERE slug = 'insumos'), 'insumos', $1, $2, 'advertencia')`,
    [insumoId, `El insumo "${nombreInsumo}" está por debajo del stock mínimo (actual: ${cantidadActual})`],
  );
}

export { pool };
