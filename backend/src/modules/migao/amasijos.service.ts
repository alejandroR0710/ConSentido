import { PoolClient } from "pg";
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

interface FilaReceta {
  base_producto_id: string;
  base_nombre: string;
  amasijo_producto_id: string;
  amasijo_nombre: string;
  stock_unidades: string;
  stock_minimo_unidades: string | null;
  cantidad_amasijo: string;
}

const SELECT_RECETAS = `
  SELECT
    bp.id AS base_producto_id, bp.nombre AS base_nombre,
    ap.id AS amasijo_producto_id, ap.nombre AS amasijo_nombre,
    ap.stock_unidades, ap.stock_minimo_unidades,
    br.cantidad_amasijo
  FROM migao_base_recetas br
  JOIN migao_inventario_productos bp ON bp.id = br.base_producto_id
  JOIN migao_inventario_productos ap ON ap.id = br.amasijo_producto_id
  ORDER BY bp.nombre, ap.nombre
`;

/**
 * Reparte un mismo cupo de amasijos entre las 4 recetas (no cada una como si
 * tuviera el sobrante entero para ella sola — varias recetas suelen
 * compartir un mismo amasijo). "Disponible" es stock actual MENOS el
 * mínimo (nunca negativo); ese cupo se reduce a medida que se reparte,
 * respetando el mínimo de cada amasijo en todo momento.
 *
 * Reparto round-robin: se recorren las bases (orden alfabético, fijo) una y
 * otra vez, sumando 1 unidad a la primera que todavía alcance con lo que
 * queda del cupo compartido — así ninguna receta se queda con todo un
 * amasijo compartido solo por calcularse primero.
 *
 * Se usa tanto para MOSTRAR la recomendación (obtenerRecomendaciones, sin
 * lock) como para APLICARLA de una (prepararRecomendado, con lock) — mismo
 * cálculo en los dos casos, así lo que se ve en pantalla es exactamente lo
 * que se prepara al confirmar.
 */
function calcularRecomendaciones(filas: FilaReceta[]) {
  const porBase = new Map<string, { baseNombre: string; lineas: FilaReceta[] }>();
  for (const row of filas) {
    const actual = porBase.get(row.base_producto_id) ?? { baseNombre: row.base_nombre, lineas: [] as FilaReceta[] };
    actual.lineas.push(row);
    porBase.set(row.base_producto_id, actual);
  }

  // Cupo compartido por amasijo — una sola vez por amasijo, sin importar en
  // cuántas recetas aparezca.
  const cupoAmasijos = new Map<string, number>();
  for (const row of filas) {
    if (!cupoAmasijos.has(row.amasijo_producto_id)) {
      cupoAmasijos.set(
        row.amasijo_producto_id,
        Math.max(0, Number(row.stock_unidades) - Number(row.stock_minimo_unidades ?? 0)),
      );
    }
  }

  const bases = Array.from(porBase.entries())
    .map(([baseProductoId, { baseNombre, lineas }]) => ({ baseProductoId, baseNombre, lineas, cantidadRecomendada: 0 }))
    .sort((a, b) => a.baseNombre.localeCompare(b.baseNombre));

  let huboAvance = true;
  while (huboAvance) {
    huboAvance = false;
    for (const base of bases) {
      const alcanza = base.lineas.every(
        (l) => (cupoAmasijos.get(l.amasijo_producto_id) ?? 0) >= Number(l.cantidad_amasijo),
      );
      if (!alcanza) continue;
      for (const l of base.lineas) {
        cupoAmasijos.set(l.amasijo_producto_id, (cupoAmasijos.get(l.amasijo_producto_id) ?? 0) - Number(l.cantidad_amasijo));
      }
      base.cantidadRecomendada += 1;
      huboAvance = true;
    }
  }

  // Con qué se topó cada base para no poder sumar una unidad más — con el
  // cupo YA repartido, no con el sobrante original.
  return bases.map((base) => ({
    baseProductoId: base.baseProductoId,
    baseNombre: base.baseNombre,
    cantidadRecomendada: base.cantidadRecomendada,
    lineas: base.lineas,
    limitantes: base.lineas
      .filter((l) => (cupoAmasijos.get(l.amasijo_producto_id) ?? 0) < Number(l.cantidad_amasijo))
      .map((l) => ({
        amasijoNombre: l.amasijo_nombre,
        disponibleSobreMinimo: cupoAmasijos.get(l.amasijo_producto_id) ?? 0,
        necesario: Number(l.cantidad_amasijo),
      })),
  }));
}

/** Aplica la preparación de UNA base dentro de una transacción YA abierta —
 *  descuenta cada amasijo de su receta y da entrada a la base. No abre ni
 *  cierra transacción: la maneja el llamador (prepararBaseSiAplica para una
 *  sola base con su propia transacción, prepararRecomendado para el lote
 *  completo en una sola transacción compartida). */
async function aplicarPreparacionBase(
  client: PoolClient,
  baseProductoId: string,
  cantidad: number,
  recetaLineas: { amasijo_producto_id: string; cantidad_amasijo: string | number }[],
  motivo: string | undefined,
  usuarioId: string,
) {
  const motivoFinal = motivo?.trim() || `Preparación de ${cantidad} base(s)`;
  const alertas: string[] = [];

  for (const linea of recetaLineas) {
    const cantidadNecesaria = Number(linea.cantidad_amasijo) * cantidad;
    const actualizado = await inventarioRepo.ajustarStock(client, linea.amasijo_producto_id, -cantidadNecesaria);
    await inventarioRepo.insertMovimiento(client, {
      productoId: linea.amasijo_producto_id,
      tipo: "consumo",
      cantidadUnidades: -cantidadNecesaria,
      motivo: motivoFinal,
      referenciaEntidad: "preparacion_base",
      referenciaId: baseProductoId,
      usuarioId,
    });
    if (actualizado && Number(actualizado.stock_unidades) < 0) {
      // Ver mismo comentario en inventario.service.ts: Number(...) limpia el
      // "-5.000" crudo de Postgres a "-5" antes de mostrarlo.
      alertas.push(`⚠ Sin stock suficiente de "${actualizado.nombre}" — quedan ${Number(actualizado.stock_unidades)} ${actualizado.unidad_medida}.`);
    }
  }

  const producto = await inventarioRepo.ajustarStock(client, baseProductoId, cantidad);
  const movimiento = await inventarioRepo.insertMovimiento(client, {
    productoId: baseProductoId,
    tipo: "entrada",
    cantidadUnidades: cantidad,
    motivo: motivoFinal,
    referenciaEntidad: "preparacion_base",
    usuarioId,
  });

  return { producto, movimiento, alertasInventario: alertas };
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

/** Cuántas bases de cada tipo conviene preparar — ver calcularRecomendaciones. */
export async function obtenerRecomendaciones(): Promise<RecomendacionBase[]> {
  const r = await pool.query(SELECT_RECETAS);
  return calcularRecomendaciones(r.rows).map(({ lineas: _lineas, ...resto }) => resto);
}

/**
 * Prepara TODAS las bases recomendadas de una sola vez, en una única
 * transacción — a diferencia de prepararBase (una base a la vez), acá el
 * cálculo de cuánto le toca a cada una y el descuento real de los amasijos
 * ocurren juntos, con el mismo cupo compartido bloqueado con FOR UPDATE. Así
 * se evita el problema de preparar una base primero (lo que consumiría
 * amasijos que otras recetas también necesitan) y que la recomendación de
 * las demás quede desactualizada a mitad de camino.
 */
export async function prepararRecomendado(usuarioId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bloquea los amasijos involucrados: nadie más puede vender/preparar
    // mientras se decide y aplica cuánto le toca a cada base.
    const r = await client.query(`${SELECT_RECETAS} FOR UPDATE OF ap`);
    const recomendaciones = calcularRecomendaciones(r.rows);

    const resultado: Array<{ baseProductoId: string; baseNombre: string; cantidadPreparada: number; alertasInventario: string[] }> = [];
    for (const rec of recomendaciones) {
      if (rec.cantidadRecomendada <= 0) continue;
      const aplicado = await aplicarPreparacionBase(
        client,
        rec.baseProductoId,
        rec.cantidadRecomendada,
        rec.lineas,
        "Preparación recomendada (lote)",
        usuarioId,
      );
      resultado.push({
        baseProductoId: rec.baseProductoId,
        baseNombre: rec.baseNombre,
        cantidadPreparada: rec.cantidadRecomendada,
        alertasInventario: aplicado.alertasInventario,
      });
    }

    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Si `productoId` es una base con receta configurada (tiene filas en
 * migao_base_recetas), registrar su "entrada" se resuelve como preparación:
 * descuenta cada amasijo según la receta y le da entrada a la base, todo en
 * una sola transacción — nunca bloquea, si algún amasijo queda en negativo
 * solo se avisa. Si el producto NO tiene receta (es un amasijo suelto, una
 * torta, un queso...), devuelve null y el llamador sigue con una entrada de
 * stock normal, sin tocar nada más.
 *
 * Único punto de esta lógica: lo usa tanto "Preparar bases" del módulo de
 * Amasijos como registrar una entrada desde el Inventario general de Migao
 * — da igual desde dónde se registre, el resultado es el mismo (ver
 * inventario.service.ts::registrarMovimiento).
 */
export async function prepararBaseSiAplica(
  baseProductoId: string,
  cantidad: number,
  motivo: string | undefined,
  usuarioId: string,
) {
  const recetaResult = await pool.query(
    `SELECT amasijo_producto_id, cantidad_amasijo FROM migao_base_recetas WHERE base_producto_id = $1`,
    [baseProductoId],
  );
  if (recetaResult.rowCount === 0) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await aplicarPreparacionBase(client, baseProductoId, cantidad, recetaResult.rows, motivo, usuarioId);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Usado por el botón "Preparar" del módulo de Amasijos. */
export async function prepararBase(baseProductoId: string, cantidad: number, usuarioId: string) {
  const resultado = await prepararBaseSiAplica(baseProductoId, cantidad, undefined, usuarioId);
  if (!resultado) {
    throw Errors.badRequest("Esta base todavía no tiene receta — agrégale al menos un amasijo antes de prepararla");
  }
  return { baseProductoId, cantidad, alertas: resultado.alertasInventario };
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
