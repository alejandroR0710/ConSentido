import { pool } from "../../shared/db/pool";
import type {
  ActualizarCeraInput,
  ActualizarFraganciaInput,
  ActualizarInsumoVelaInput,
  ActualizarPabiloInput,
  ActualizarParametrosInput,
  CrearCeraInput,
  CrearFraganciaInput,
  CrearInsumoVelaInput,
  CrearPabiloInput,
} from "./velas.schema";

// ============================================================================
// Ceras
// ============================================================================

const COLUMNAS_CERA = `id, nombre, presentacion_kg, precio_compra, valor_gramo, proveedor, activo, created_at, updated_at`;

export async function listCeras() {
  const r = await pool.query(`SELECT ${COLUMNAS_CERA} FROM velas_ceras WHERE activo = true ORDER BY nombre ASC`);
  return r.rows;
}
export async function listCerasAdmin() {
  const r = await pool.query(`SELECT ${COLUMNAS_CERA} FROM velas_ceras ORDER BY nombre ASC`);
  return r.rows;
}
export async function getCerasByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNAS_CERA} FROM velas_ceras WHERE id = ANY($1)`, [ids]);
  return r.rows;
}
export async function crearCera(data: CrearCeraInput) {
  const r = await pool.query(
    `INSERT INTO velas_ceras (nombre, presentacion_kg, precio_compra, proveedor)
     VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS_CERA}`,
    [data.nombre, data.presentacionKg, data.precioCompra, data.proveedor ?? null],
  );
  return r.rows[0];
}
export async function actualizarCera(id: string, data: ActualizarCeraInput) {
  const r = await pool.query(
    `UPDATE velas_ceras SET
       nombre = COALESCE($2, nombre),
       presentacion_kg = COALESCE($3, presentacion_kg),
       precio_compra = COALESCE($4, precio_compra),
       proveedor = COALESCE($5, proveedor),
       activo = COALESCE($6, activo),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNAS_CERA}`,
    [id, data.nombre ?? null, data.presentacionKg ?? null, data.precioCompra ?? null, data.proveedor ?? null, data.activo ?? null],
  );
  return r.rowCount ? r.rows[0] : null;
}

// ============================================================================
// Fragancias
// ============================================================================

const COLUMNAS_FRAGANCIA = `id, nombre, presentacion_g, precio_compra, valor_gramo, activo, created_at, updated_at`;

export async function listFragancias() {
  const r = await pool.query(`SELECT ${COLUMNAS_FRAGANCIA} FROM velas_fragancias WHERE activo = true ORDER BY nombre ASC`);
  return r.rows;
}
export async function listFraganciasAdmin() {
  const r = await pool.query(`SELECT ${COLUMNAS_FRAGANCIA} FROM velas_fragancias ORDER BY nombre ASC`);
  return r.rows;
}
export async function getFraganciasByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNAS_FRAGANCIA} FROM velas_fragancias WHERE id = ANY($1)`, [ids]);
  return r.rows;
}
export async function crearFragancia(data: CrearFraganciaInput) {
  const r = await pool.query(
    `INSERT INTO velas_fragancias (nombre, presentacion_g, precio_compra)
     VALUES ($1, $2, $3) RETURNING ${COLUMNAS_FRAGANCIA}`,
    [data.nombre, data.presentacionG, data.precioCompra],
  );
  return r.rows[0];
}
export async function actualizarFragancia(id: string, data: ActualizarFraganciaInput) {
  const r = await pool.query(
    `UPDATE velas_fragancias SET
       nombre = COALESCE($2, nombre),
       presentacion_g = COALESCE($3, presentacion_g),
       precio_compra = COALESCE($4, precio_compra),
       activo = COALESCE($5, activo),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNAS_FRAGANCIA}`,
    [id, data.nombre ?? null, data.presentacionG ?? null, data.precioCompra ?? null, data.activo ?? null],
  );
  return r.rowCount ? r.rows[0] : null;
}

// ============================================================================
// Pabilos
// ============================================================================

const COLUMNAS_PABILO = `id, talla, longitud_m, precio_carrete, valor_cm, activo, created_at, updated_at`;

export async function listPabilos() {
  const r = await pool.query(`SELECT ${COLUMNAS_PABILO} FROM velas_pabilos WHERE activo = true ORDER BY talla ASC`);
  return r.rows;
}
export async function listPabilosAdmin() {
  const r = await pool.query(`SELECT ${COLUMNAS_PABILO} FROM velas_pabilos ORDER BY talla ASC`);
  return r.rows;
}
export async function getPabiloById(id: string) {
  const r = await pool.query(`SELECT ${COLUMNAS_PABILO} FROM velas_pabilos WHERE id = $1`, [id]);
  return r.rowCount ? r.rows[0] : null;
}
export async function crearPabilo(data: CrearPabiloInput) {
  const r = await pool.query(
    `INSERT INTO velas_pabilos (talla, longitud_m, precio_carrete)
     VALUES ($1, $2, $3) RETURNING ${COLUMNAS_PABILO}`,
    [data.talla, data.longitudM, data.precioCarrete],
  );
  return r.rows[0];
}
export async function actualizarPabilo(id: string, data: ActualizarPabiloInput) {
  const r = await pool.query(
    `UPDATE velas_pabilos SET
       talla = COALESCE($2, talla),
       longitud_m = COALESCE($3, longitud_m),
       precio_carrete = COALESCE($4, precio_carrete),
       activo = COALESCE($5, activo),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNAS_PABILO}`,
    [id, data.talla ?? null, data.longitudM ?? null, data.precioCarrete ?? null, data.activo ?? null],
  );
  return r.rowCount ? r.rows[0] : null;
}

// ============================================================================
// Insumos (recipientes, tapas, empaques, decoración, identidad, papelería,
// protección, otros)
// ============================================================================

const COLUMNAS_INSUMO = `id, codigo, nombre, categoria, unidad_costo, valor_unitario, cantidad_por_paquete, precio_paquete, proveedor, activo, created_at, updated_at`;

export async function listInsumosVela() {
  const r = await pool.query(`SELECT ${COLUMNAS_INSUMO} FROM velas_insumos WHERE activo = true ORDER BY categoria ASC, nombre ASC`);
  return r.rows;
}
export async function listInsumosVelaAdmin() {
  const r = await pool.query(`SELECT ${COLUMNAS_INSUMO} FROM velas_insumos ORDER BY categoria ASC, nombre ASC`);
  return r.rows;
}
export async function getInsumosVelaByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const r = await pool.query(`SELECT ${COLUMNAS_INSUMO} FROM velas_insumos WHERE id = ANY($1)`, [ids]);
  return r.rows;
}
export async function crearInsumoVela(data: CrearInsumoVelaInput) {
  const r = await pool.query(
    `INSERT INTO velas_insumos (codigo, nombre, categoria, unidad_costo, valor_unitario, cantidad_por_paquete, precio_paquete, proveedor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNAS_INSUMO}`,
    [
      data.codigo ?? null,
      data.nombre,
      data.categoria,
      data.unidadCosto,
      data.valorUnitario,
      data.cantidadPorPaquete ?? null,
      data.precioPaquete ?? null,
      data.proveedor ?? null,
    ],
  );
  return r.rows[0];
}
export async function actualizarInsumoVela(id: string, data: ActualizarInsumoVelaInput) {
  const r = await pool.query(
    `UPDATE velas_insumos SET
       codigo = COALESCE($2, codigo),
       nombre = COALESCE($3, nombre),
       categoria = COALESCE($4, categoria),
       unidad_costo = COALESCE($5, unidad_costo),
       valor_unitario = COALESCE($6, valor_unitario),
       cantidad_por_paquete = COALESCE($7, cantidad_por_paquete),
       precio_paquete = COALESCE($8, precio_paquete),
       proveedor = COALESCE($9, proveedor),
       activo = COALESCE($10, activo),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNAS_INSUMO}`,
    [
      id,
      data.codigo ?? null,
      data.nombre ?? null,
      data.categoria ?? null,
      data.unidadCosto ?? null,
      data.valorUnitario ?? null,
      data.cantidadPorPaquete ?? null,
      data.precioPaquete ?? null,
      data.proveedor ?? null,
      data.activo ?? null,
    ],
  );
  return r.rowCount ? r.rows[0] : null;
}

// ============================================================================
// Parámetros globales (fila única)
// ============================================================================

export async function getParametros() {
  const r = await pool.query(`SELECT * FROM velas_parametros WHERE id = true`);
  return r.rows[0];
}
export async function actualizarParametros(data: ActualizarParametrosInput) {
  const r = await pool.query(
    `UPDATE velas_parametros SET multiplicador_precio = $1, updated_at = now()
     WHERE id = true RETURNING *`,
    [data.multiplicadorPrecio],
  );
  return r.rows[0];
}

// ============================================================================
// Productos (recetas guardadas) — la composición es lo único que se
// persiste; el costo siempre se recalcula en vivo (ver velas.service.ts).
// ============================================================================

export type LineaInsumoReceta =
  | { insumoId: string; cantidad: number }
  | { nombreManual: string; valorUnitarioManual: number; cantidad: number };

export interface ComposicionReceta {
  tipoVela: "decorativa" | "vaso" | "wax_melt";
  pesoMezclaG: number;
  ceras: { ceraId: string; gramos: number }[];
  fragancias: { fraganciaId: string; porcentaje: number }[];
  pabiloId?: string;
  cmPabilo?: number;
  insumos: LineaInsumoReceta[];
  costoManoObra: number;
  multiplicadorPrecio?: number;
  redondeo: number;
}

export async function listProductos() {
  const r = await pool.query(
    `SELECT id, nombre, peso_mezcla_g, precio_final_autorizado, activo, created_at, updated_at
       FROM velas_productos ORDER BY updated_at DESC`,
  );
  return r.rows;
}

export async function getProductoById(id: string) {
  const producto = await pool.query(`SELECT * FROM velas_productos WHERE id = $1`, [id]);
  if (!producto.rowCount) return null;
  const [ceras, fragancias, insumos] = await Promise.all([
    pool.query(`SELECT cera_id, gramos FROM velas_producto_ceras WHERE producto_id = $1`, [id]),
    pool.query(`SELECT fragancia_id, porcentaje FROM velas_producto_fragancias WHERE producto_id = $1`, [id]),
    pool.query(
      `SELECT insumo_id, nombre_manual, valor_unitario_manual, cantidad FROM velas_producto_insumos WHERE producto_id = $1`,
      [id],
    ),
  ]);
  return {
    producto: producto.rows[0],
    composicion: {
      tipoVela: producto.rows[0].tipo_vela,
      pesoMezclaG: Number(producto.rows[0].peso_mezcla_g),
      ceras: ceras.rows.map((c) => ({ ceraId: c.cera_id, gramos: Number(c.gramos) })),
      fragancias: fragancias.rows.map((f) => ({ fraganciaId: f.fragancia_id, porcentaje: Number(f.porcentaje) })),
      pabiloId: producto.rows[0].pabilo_id ?? undefined,
      cmPabilo: producto.rows[0].cm_pabilo != null ? Number(producto.rows[0].cm_pabilo) : undefined,
      insumos: insumos.rows.map((i) =>
        i.insumo_id
          ? { insumoId: i.insumo_id as string, cantidad: Number(i.cantidad) }
          : { nombreManual: i.nombre_manual as string, valorUnitarioManual: Number(i.valor_unitario_manual), cantidad: Number(i.cantidad) },
      ),
      costoManoObra: Number(producto.rows[0].costo_mano_obra),
      multiplicadorPrecio:
        producto.rows[0].multiplicador_precio != null ? Number(producto.rows[0].multiplicador_precio) : undefined,
      redondeo: Number(producto.rows[0].redondeo),
    } satisfies ComposicionReceta,
  };
}

async function reemplazarComposicion(client: import("pg").PoolClient, productoId: string, c: ComposicionReceta) {
  await client.query(`DELETE FROM velas_producto_ceras WHERE producto_id = $1`, [productoId]);
  await client.query(`DELETE FROM velas_producto_fragancias WHERE producto_id = $1`, [productoId]);
  await client.query(`DELETE FROM velas_producto_insumos WHERE producto_id = $1`, [productoId]);
  for (const cera of c.ceras) {
    await client.query(
      `INSERT INTO velas_producto_ceras (producto_id, cera_id, gramos) VALUES ($1, $2, $3)`,
      [productoId, cera.ceraId, cera.gramos],
    );
  }
  for (const frag of c.fragancias) {
    await client.query(
      `INSERT INTO velas_producto_fragancias (producto_id, fragancia_id, porcentaje) VALUES ($1, $2, $3)`,
      [productoId, frag.fraganciaId, frag.porcentaje],
    );
  }
  for (const ins of c.insumos) {
    if ("insumoId" in ins) {
      await client.query(
        `INSERT INTO velas_producto_insumos (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)`,
        [productoId, ins.insumoId, ins.cantidad],
      );
    } else {
      await client.query(
        `INSERT INTO velas_producto_insumos (producto_id, nombre_manual, valor_unitario_manual, cantidad) VALUES ($1, $2, $3, $4)`,
        [productoId, ins.nombreManual, ins.valorUnitarioManual, ins.cantidad],
      );
    }
  }
}

export async function crearProducto(
  data: ComposicionReceta & { nombre: string; notas?: string; precioFinalAutorizado?: number },
  usuarioId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO velas_productos
         (nombre, tipo_vela, peso_mezcla_g, pabilo_id, cm_pabilo, costo_mano_obra, multiplicador_precio, redondeo, precio_final_autorizado, notas, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        data.nombre,
        data.tipoVela,
        data.pesoMezclaG,
        data.pabiloId ?? null,
        data.cmPabilo ?? null,
        data.costoManoObra,
        data.multiplicadorPrecio ?? null,
        data.redondeo,
        data.precioFinalAutorizado ?? null,
        data.notas ?? null,
        usuarioId,
      ],
    );
    const productoId = r.rows[0].id as string;
    await reemplazarComposicion(client, productoId, data);
    await client.query("COMMIT");
    return productoId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function actualizarProducto(
  id: string,
  data: Partial<ComposicionReceta> & { nombre?: string; notas?: string; precioFinalAutorizado?: number; activo?: boolean },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE velas_productos SET
         nombre = COALESCE($2, nombre),
         tipo_vela = COALESCE($3, tipo_vela),
         peso_mezcla_g = COALESCE($4, peso_mezcla_g),
         pabilo_id = COALESCE($5, pabilo_id),
         cm_pabilo = COALESCE($6, cm_pabilo),
         costo_mano_obra = COALESCE($7, costo_mano_obra),
         multiplicador_precio = COALESCE($8, multiplicador_precio),
         redondeo = COALESCE($9, redondeo),
         precio_final_autorizado = COALESCE($10, precio_final_autorizado),
         notas = COALESCE($11, notas),
         activo = COALESCE($12, activo),
         updated_at = now()
       WHERE id = $1 RETURNING id`,
      [
        id,
        data.nombre ?? null,
        data.tipoVela ?? null,
        data.pesoMezclaG ?? null,
        data.pabiloId ?? null,
        data.cmPabilo ?? null,
        data.costoManoObra ?? null,
        data.multiplicadorPrecio ?? null,
        data.redondeo ?? null,
        data.precioFinalAutorizado ?? null,
        data.notas ?? null,
        data.activo ?? null,
      ],
    );
    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    // Solo se reemplaza la composición si vino alguna de sus partes en el
    // PATCH — si el cliente solo quiere cambiar el nombre, no se toca.
    if (data.ceras || data.fragancias || data.insumos) {
      const actual = await getProductoById(id);
      await reemplazarComposicion(client, id, {
        tipoVela: data.tipoVela ?? actual!.composicion.tipoVela,
        pesoMezclaG: data.pesoMezclaG ?? actual!.composicion.pesoMezclaG,
        ceras: data.ceras ?? actual!.composicion.ceras,
        fragancias: data.fragancias ?? actual!.composicion.fragancias,
        pabiloId: data.pabiloId ?? actual!.composicion.pabiloId,
        cmPabilo: data.cmPabilo ?? actual!.composicion.cmPabilo,
        insumos: data.insumos ?? actual!.composicion.insumos,
        costoManoObra: data.costoManoObra ?? actual!.composicion.costoManoObra,
        multiplicadorPrecio: data.multiplicadorPrecio ?? actual!.composicion.multiplicadorPrecio,
        redondeo: data.redondeo ?? actual!.composicion.redondeo,
      });
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function eliminarProducto(id: string) {
  const r = await pool.query(`DELETE FROM velas_productos WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
