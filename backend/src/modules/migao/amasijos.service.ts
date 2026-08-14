import { pool } from "../../shared/db/pool";
import { PoolClient } from "pg";

interface RecomendacionBase {
  baseTipo: string;
  cantidadRecomendada: number;
  limitantes: Array<{
    amasijoTipo: string;
    disponible: number;
    necesario: number;
    botellaCuello: boolean;
  }>;
}

/**
 * Obtiene el estado actual de cada amasijo:
 * - Comprado (total entrada)
 * - Usado (total consumo)
 * - Vendido (total venta)
 * - Disponible (comprado - usado - vendido)
 */
export async function obtenerEstadoAmasijos() {
  const result = await pool.query(`
    SELECT
      at.id,
      at.nombre,
      COALESCE(
        (SELECT SUM(COALESCE(cantidad_completa, 0))
         FROM migao_amasijos_movimientos
         WHERE amasijo_id IN (
           SELECT id FROM migao_amasijos WHERE amasijo_tipo_id = at.id
         ) AND tipo = 'entrada'),
        0
      )::numeric AS comprado,
      COALESCE(
        (SELECT SUM(COALESCE(cantidad_completa, 0))
         FROM migao_amasijos_movimientos
         WHERE amasijo_id IN (
           SELECT id FROM migao_amasijos WHERE amasijo_tipo_id = at.id
         ) AND tipo = 'consumo'),
        0
      )::numeric AS usado,
      COALESCE(
        (SELECT SUM(COALESCE(cantidad_completa, 0))
         FROM migao_amasijos_movimientos
         WHERE amasijo_id IN (
           SELECT id FROM migao_amasijos WHERE amasijo_tipo_id = at.id
         ) AND (tipo = 'venta_completo' OR tipo = 'venta_medio')),
        0
      )::numeric AS vendido,
      COALESCE(
        (SELECT SUM(COALESCE(cantidad_completa, 0) + COALESCE(cantidad_media, 0) * 0.5)
         FROM migao_amasijos
         WHERE amasijo_tipo_id = at.id),
        0
      )::numeric AS disponible
    FROM migao_amasijo_tipos at
    WHERE at.activo = true
    ORDER BY at.nombre
  `);

  return result.rows.map(row => ({
    id: row.id,
    nombre: row.nombre,
    comprado: Number(row.comprado),
    usado: Number(row.usado),
    vendido: Number(row.vendido),
    disponible: Number(row.disponible),
  }));
}

/**
 * Obtiene el estado de cada base preparada:
 * - Preparados
 * - Vendidos
 * - Disponibles (preparados - vendidos)
 */
export async function obtenerEstadoBasesPrepаradas() {
  const result = await pool.query(`
    SELECT
      bt.id,
      bt.nombre,
      COALESCE(bp.cantidad_preparada, 0)::numeric AS preparados,
      COALESCE(bp.cantidad_vendida, 0)::numeric AS vendidos,
      (COALESCE(bp.cantidad_preparada, 0) - COALESCE(bp.cantidad_vendida, 0))::numeric AS disponibles
    FROM migao_base_tipos bt
    LEFT JOIN migao_bases_preparadas bp ON bp.base_tipo_id = bt.id
    WHERE bt.activo = true
    ORDER BY bt.nombre
  `);

  return result.rows.map(row => ({
    id: row.id,
    nombre: row.nombre,
    preparados: Number(row.preparados),
    vendidos: Number(row.vendidos),
    disponibles: Number(row.disponibles),
  }));
}

/**
 * Calcula recomendación de cuántas bases de cada tipo se pueden preparar
 * basado en los amasijos disponibles. Devuelve:
 * - cantidadRecomendada: cuántas bases se pueden hacer
 * - limitantes: qué amasijos son el cuello de botella
 */
export async function obtenerRecomendacionesPreparacion(): Promise<RecomendacionBase[]> {
  // Obtener todas las recetas
  const recetasResult = await pool.query(`
    SELECT
      bt.id,
      bt.nombre,
      array_agg(
        jsonb_build_object(
          'amasijo_tipo_id', at.id,
          'amasijo_nombre', at.nombre,
          'cantidad_necesaria', br.cantidad_amasijo
        )
      ) AS ingredientes
    FROM migao_base_tipos bt
    LEFT JOIN migao_base_recetas br ON br.base_tipo_id = bt.id
    LEFT JOIN migao_amasijo_tipos at ON at.id = br.amasijo_tipo_id
    WHERE bt.activo = true
    GROUP BY bt.id, bt.nombre
    ORDER BY bt.nombre
  `);

  // Obtener disponibilidad actual de cada amasijo
  const estadoAmasijos = await obtenerEstadoAmasijos();
  const disponiblePorAmasijo = new Map(
    estadoAmasijos.map(a => [a.id, a.disponible])
  );

  // Calcular recomendación para cada base
  return recetasResult.rows.map((row: any) => {
    const ingredientes = row.ingredientes.filter((ing: any) => ing.amasijo_tipo_id !== null);

    if (ingredientes.length === 0) {
      return {
        baseTipo: row.nombre,
        cantidadRecomendada: 0,
        limitantes: [],
      };
    }

    // Para cada ingrediente, calcular cuántas bases se pueden hacer
    const limitantes = ingredientes.map((ing: any) => {
      const disponible = disponiblePorAmasijo.get(ing.amasijo_tipo_id) || 0;
      const cantidadPorBase = ing.cantidad_necesaria;
      const posiblesPorIngrediente = Math.floor(disponible / cantidadPorBase);

      return {
        amasijoTipo: ing.amasijo_nombre,
        disponible: Number(disponible.toFixed(3)),
        necesario: cantidadPorBase,
        posible: posiblesPorIngrediente,
        botellaCuello: true, // Se marca en el paso siguiente
      };
    });

    // La cantidad máxima que se puede preparar es el mínimo entre todos los ingredientes
    const cantidadRecomendada = Math.min(...limitantes.map((l: any) => l.posible));

    // Marcar solo los que realmente son limitantes
    limitantes.forEach((l: any) => {
      l.botellaCuello = l.posible === cantidadRecomendada;
    });

    return {
      baseTipo: row.nombre,
      cantidadRecomendada,
      limitantes: limitantes.filter(l => l.botellaCuello),
    };
  });
}

/**
 * Registra entrada de amasijos (compra)
 */
export async function registrarEntradaAmasijo(
  amasijoTipoId: number,
  cantidadCompleta: number,
  cantidadMedia: number,
  motivo: string,
  usuarioId: string | null
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Obtener o crear registro de amasijo
    let amasijoResult = await client.query(
      "SELECT id FROM migao_amasijos WHERE amasijo_tipo_id = $1 LIMIT 1",
      [amasijoTipoId]
    );

    let amasijoId;
    if (amasijoResult.rows.length === 0) {
      const crearResult = await client.query(
        "INSERT INTO migao_amasijos (amasijo_tipo_id) VALUES ($1) RETURNING id",
        [amasijoTipoId]
      );
      amasijoId = crearResult.rows[0].id;
    } else {
      amasijoId = amasijoResult.rows[0].id;
    }

    // Actualizar inventario
    await client.query(
      `UPDATE migao_amasijos
       SET cantidad_completa = cantidad_completa + $1,
           cantidad_media = cantidad_media + $2
       WHERE id = $3`,
      [cantidadCompleta, cantidadMedia, amasijoId]
    );

    // Registrar movimiento
    await client.query(
      `INSERT INTO migao_amasijos_movimientos
       (amasijo_id, tipo, cantidad_completa, cantidad_media, motivo, usuario_id)
       VALUES ($1, 'entrada', $2, $3, $4, $5)`,
      [amasijoId, cantidadCompleta, cantidadMedia, motivo, usuarioId]
    );

    await client.query("COMMIT");
    return { amasijoId, cantidadCompleta, cantidadMedia };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Prepara bases: consume amasijos según receta y crea bases preparadas
 */
export async function prepararBases(
  baseTipoId: number,
  cantidad: number,
  usuarioId: string | null
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Obtener receta
    const recetaResult = await client.query(
      `SELECT br.amasijo_tipo_id, br.cantidad_amasijo
       FROM migao_base_recetas br
       WHERE br.base_tipo_id = $1`,
      [baseTipoId]
    );

    if (recetaResult.rows.length === 0) {
      throw new Error("No hay receta definida para esta base");
    }

    // Validar disponibilidad y consumir amasijos
    for (const receta of recetaResult.rows) {
      const cantidadNecesaria = receta.cantidad_amasijo * cantidad;

      // Obtener amasijo actual
      const amasijoResult = await client.query(
        `SELECT id FROM migao_amasijos WHERE amasijo_tipo_id = $1 LIMIT 1`,
        [receta.amasijo_tipo_id]
      );

      if (amasijoResult.rows.length === 0) {
        throw new Error(`No hay inventario de este amasijo: ${receta.amasijo_tipo_id}`);
      }

      const amasijoId = amasijoResult.rows[0].id;

      // Restar del inventario
      await client.query(
        `UPDATE migao_amasijos
         SET cantidad_completa = cantidad_completa - $1
         WHERE id = $2 AND cantidad_completa >= $1`,
        [cantidadNecesaria, amasijoId]
      );

      // Registrar consumo
      await client.query(
        `INSERT INTO migao_amasijos_movimientos
         (amasijo_id, tipo, cantidad_completa, motivo, usuario_id)
         VALUES ($1, 'consumo', $2, $3, $4)`,
        [amasijoId, cantidadNecesaria, `Preparación de bases`, usuarioId]
      );
    }

    // Agregar bases preparadas
    const baseResult = await client.query(
      `SELECT id FROM migao_bases_preparadas WHERE base_tipo_id = $1`,
      [baseTipoId]
    );

    if (baseResult.rows.length > 0) {
      const baseId = baseResult.rows[0].id;
      await client.query(
        `UPDATE migao_bases_preparadas
         SET cantidad_preparada = cantidad_preparada + $1
         WHERE id = $2`,
        [cantidad, baseId]
      );

      // Registrar movimiento de preparación
      await client.query(
        `INSERT INTO migao_bases_movimientos
         (base_id, tipo, cantidad, motivo, usuario_id)
         VALUES ($1, 'preparacion', $2, $3, $4)`,
        [baseId, cantidad, `Preparación de ${cantidad} bases`, usuarioId]
      );
    }

    await client.query("COMMIT");
    return { baseTipoId, cantidad };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Obtiene las recetas actuales (configurable)
 */
export async function obtenerRecetas() {
  const result = await pool.query(`
    SELECT
      br.id,
      bt.id as base_tipo_id,
      bt.nombre as base_nombre,
      at.id as amasijo_tipo_id,
      at.nombre as amasijo_nombre,
      br.cantidad_amasijo
    FROM migao_base_recetas br
    JOIN migao_base_tipos bt ON bt.id = br.base_tipo_id
    JOIN migao_amasijo_tipos at ON at.id = br.amasijo_tipo_id
    ORDER BY bt.nombre, at.nombre
  `);

  return result.rows;
}

/**
 * Actualiza una receta (cantidad de amasijo para una base)
 */
export async function actualizarReceta(
  recetaId: string,
  cantidadAmasijo: number,
  usuarioId: string | null
) {
  await pool.query(
    `UPDATE migao_base_recetas
     SET cantidad_amasijo = $1
     WHERE id = $2`,
    [cantidadAmasijo, recetaId]
  );

  return { recetaId, cantidadAmasijo };
}
