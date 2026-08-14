import { pool } from "../../shared/db/pool";
import { Errors } from "../../shared/utils/app-error";
import * as inventarioRepo from "./inventario.repository";

// ============================================================================
// Amasijos y bases: NO tienen inventario propio — son productos normales de
// migao_inventario_productos (el mismo inventario general de Migao, con su
// propio stock y stock mínimo). Este módulo solo agrega dos cosas que el
// inventario general no tiene:
//  1. La receta de cada base (qué amasijos y cuánto la arman) — migao_base_recetas.
//  2. La recomendación de cuántas bases se pueden preparar sin bajar del
//     stock mínimo de ningún amasijo.
// "Preparar una base" consume amasijos y da entrada a la base usando el
// mismo ajustarStock/insertMovimiento que ya usa cualquier entrada/consumo
// de inventario. Vender un producto del menú que sea un amasijo o una base
// (ej. "Almojábana" o "Migao Valluno") ya se resuelve solo con una fila en
// migao_producto_ingredientes — el mecanismo existente de
// inventarioService.aplicarConsumoPorProducto, sin código aparte.
// ============================================================================

interface RecomendacionBase {
  baseProductoId: string;
  baseNombre: string;
  cantidadRecomendada: number;
  limitantes: Array<{
    amasijoNombre: string;
    disponibleSobreMinimo: number;
    necesario: number;
  }>;
}

export async function obtenerAmasijos() {
  const r = await pool.query(`
    SELECT DISTINCT ip.id, ip.nombre, ip.stock_unidades, ip.stock_minimo_unidades
      FROM migao_base_recetas br
      JOIN migao_inventario_productos ip ON ip.id = br.amasijo_producto_id
     ORDER BY ip.nombre
  `);
  return r.rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    stockUnidades: Number(row.stock_unidades),
    stockMinimoUnidades: row.stock_minimo_unidades != null ? Number(row.stock_minimo_unidades) : null,
  }));
}

export async function obtenerBases() {
  const r = await pool.query(`
    SELECT DISTINCT ip.id, ip.nombre, ip.stock_unidades, ip.stock_minimo_unidades
      FROM migao_base_recetas br
      JOIN migao_inventario_productos ip ON ip.id = br.base_producto_id
     ORDER BY ip.nombre
  `);
  return r.rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    stockUnidades: Number(row.stock_unidades),
    stockMinimoUnidades: row.stock_minimo_unidades != null ? Number(row.stock_minimo_unidades) : null,
  }));
}

/**
 * Cuántas bases de cada tipo se pueden preparar sin bajar del stock mínimo
 * de ningún amasijo que necesite — "disponible" acá es stock actual MENOS
 * el mínimo (nunca negativo), no el stock crudo.
 */
export async function obtenerRecomendaciones(): Promise<RecomendacionBase[]> {
  const r = await pool.query(`
    SELECT
      bp.id AS base_producto_id, bp.nombre AS base_nombre,
      ap.nombre AS amasijo_nombre,
      ap.stock_unidades, ap.stock_minimo_unidades,
      br.cantidad_amasijo
    FROM migao_base_recetas br
    JOIN migao_inventario_productos bp ON bp.id = br.base_producto_id
    JOIN migao_inventario_productos ap ON ap.id = br.amasijo_producto_id
    ORDER BY bp.nombre, ap.nombre
  `);

  type FilaReceta = (typeof r.rows)[number];
  const porBase = new Map<string, { baseNombre: string; lineas: FilaReceta[] }>();
  for (const row of r.rows) {
    const actual = porBase.get(row.base_producto_id) ?? { baseNombre: row.base_nombre, lineas: [] as FilaReceta[] };
    actual.lineas.push(row);
    porBase.set(row.base_producto_id, actual);
  }

  const resultado: RecomendacionBase[] = [];
  for (const [baseProductoId, { baseNombre, lineas }] of porBase) {
    const calculadas = lineas.map((l) => {
      const disponibleSobreMinimo = Math.max(0, Number(l.stock_unidades) - Number(l.stock_minimo_unidades ?? 0));
      const necesario = Number(l.cantidad_amasijo);
      const posible = Math.floor(disponibleSobreMinimo / necesario);
      return { amasijoNombre: l.amasijo_nombre as string, disponibleSobreMinimo, necesario, posible };
    });
    const cantidadRecomendada = Math.min(...calculadas.map((c) => c.posible));
    resultado.push({
      baseProductoId,
      baseNombre,
      cantidadRecomendada,
      limitantes: calculadas
        .filter((c) => c.posible === cantidadRecomendada)
        .map((c) => ({ amasijoNombre: c.amasijoNombre, disponibleSobreMinimo: c.disponibleSobreMinimo, necesario: c.necesario })),
    });
  }
  return resultado.sort((a, b) => a.baseNombre.localeCompare(b.baseNombre));
}

/**
 * Prepara `cantidad` bases: por cada línea de la receta, descuenta del
 * amasijo lo que haga falta y le da entrada a la base — usa el mismo
 * ajustarStock/insertMovimiento del inventario general, nunca bloquea (si
 * algún amasijo queda en negativo, solo se avisa).
 */
export async function prepararBase(baseProductoId: string, cantidad: number, usuarioId: string) {
  const recetaResult = await pool.query(
    `SELECT amasijo_producto_id, cantidad_amasijo FROM migao_base_recetas WHERE base_producto_id = $1`,
    [baseProductoId],
  );
  if (recetaResult.rowCount === 0) {
    throw Errors.badRequest("Esta base todavía no tiene receta — agrégale al menos un amasijo antes de prepararla");
  }

  const client = await pool.connect();
  const alertas: string[] = [];
  try {
    await client.query("BEGIN");

    for (const linea of recetaResult.rows) {
      const cantidadNecesaria = Number(linea.cantidad_amasijo) * cantidad;
      const actualizado = await inventarioRepo.ajustarStock(client, linea.amasijo_producto_id, -cantidadNecesaria);
      await inventarioRepo.insertMovimiento(client, {
        productoId: linea.amasijo_producto_id,
        tipo: "consumo",
        cantidadUnidades: -cantidadNecesaria,
        motivo: `Preparación de ${cantidad} base(s)`,
        referenciaEntidad: "preparacion_base",
        referenciaId: baseProductoId,
        usuarioId,
      });
      if (actualizado && Number(actualizado.stock_unidades) < 0) {
        alertas.push(`⚠ Sin stock suficiente de "${actualizado.nombre}" — quedan ${actualizado.stock_unidades} ${actualizado.unidad_medida}.`);
      }
    }

    await inventarioRepo.ajustarStock(client, baseProductoId, cantidad);
    await inventarioRepo.insertMovimiento(client, {
      productoId: baseProductoId,
      tipo: "entrada",
      cantidadUnidades: cantidad,
      motivo: `Preparación de ${cantidad} base(s)`,
      referenciaEntidad: "preparacion_base",
      usuarioId,
    });

    await client.query("COMMIT");
    return { baseProductoId, cantidad, alertas };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function obtenerRecetas() {
  const r = await pool.query(`
    SELECT br.id, bp.id AS base_producto_id, bp.nombre AS base_nombre,
           ap.id AS amasijo_producto_id, ap.nombre AS amasijo_nombre, br.cantidad_amasijo
      FROM migao_base_recetas br
      JOIN migao_inventario_productos bp ON bp.id = br.base_producto_id
      JOIN migao_inventario_productos ap ON ap.id = br.amasijo_producto_id
     ORDER BY bp.nombre, ap.nombre
  `);
  return r.rows;
}

export async function crearRecetaLinea(baseProductoId: string, amasijoProductoId: string, cantidadAmasijo: number) {
  const r = await pool.query(
    `INSERT INTO migao_base_recetas (base_producto_id, amasijo_producto_id, cantidad_amasijo)
     VALUES ($1, $2, $3)
     ON CONFLICT (base_producto_id, amasijo_producto_id) DO UPDATE SET cantidad_amasijo = EXCLUDED.cantidad_amasijo
     RETURNING id`,
    [baseProductoId, amasijoProductoId, cantidadAmasijo],
  );
  return r.rows[0];
}

export async function actualizarRecetaLinea(id: string, cantidadAmasijo: number) {
  const r = await pool.query(
    `UPDATE migao_base_recetas SET cantidad_amasijo = $1 WHERE id = $2 RETURNING id`,
    [cantidadAmasijo, id],
  );
  if (!r.rowCount) throw Errors.notFound("Línea de receta no encontrada");
  return r.rows[0];
}

export async function eliminarRecetaLinea(id: string) {
  const r = await pool.query(`DELETE FROM migao_base_recetas WHERE id = $1`, [id]);
  if (!r.rowCount) throw Errors.notFound("Línea de receta no encontrada");
}
