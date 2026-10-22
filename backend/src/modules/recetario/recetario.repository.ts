import { Pool, PoolClient, pool } from "../../shared/db/pool";

type Executor = Pool | PoolClient;

export async function listarCategorias(executor: Executor = pool) {
  const result = await executor.query(`SELECT id, nombre FROM recetario_categorias ORDER BY nombre ASC`);
  return result.rows;
}

export async function crearCategoria(nombre: string, executor: Executor = pool) {
  const result = await executor.query(
    `INSERT INTO recetario_categorias (nombre) VALUES ($1) RETURNING id, nombre`,
    [nombre],
  );
  return result.rows[0];
}

export async function contarRecetasPorCategoria(categoriaId: number, executor: Executor = pool) {
  const result = await executor.query(`SELECT COUNT(*) AS total FROM recetario_recetas WHERE categoria_id = $1`, [
    categoriaId,
  ]);
  return Number(result.rows[0].total);
}

export async function eliminarCategoria(categoriaId: number, executor: Executor = pool): Promise<boolean> {
  const result = await executor.query(`DELETE FROM recetario_categorias WHERE id = $1`, [categoriaId]);
  return (result.rowCount ?? 0) > 0;
}

const SELECT_RECETA = `
  SELECT r.*, c.nombre AS categoria_nombre, u.nombre AS creado_por_nombre
    FROM recetario_recetas r
    LEFT JOIN recetario_categorias c ON c.id = r.categoria_id
    LEFT JOIN usuarios u ON u.id = r.creado_por_id
`;

export async function listarRecetas(executor: Executor = pool) {
  const result = await executor.query(`${SELECT_RECETA} ORDER BY r.titulo ASC`);
  return result.rows;
}

export async function getRecetaById(id: string, executor: Executor = pool) {
  const result = await executor.query(`${SELECT_RECETA} WHERE r.id = $1`, [id]);
  return result.rowCount ? result.rows[0] : null;
}

export async function crearReceta(
  params: {
    titulo: string;
    instrucciones: string;
    categoriaId: number | null;
    videoUrl: string | null;
    descripcionEmplatado: string | null;
    creadoPorId: string;
  },
  executor: Executor = pool,
) {
  const result = await executor.query(
    `INSERT INTO recetario_recetas (titulo, instrucciones, categoria_id, video_url, descripcion_emplatado, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.titulo,
      params.instrucciones,
      params.categoriaId,
      params.videoUrl,
      params.descripcionEmplatado,
      params.creadoPorId,
    ],
  );
  return result.rows[0].id as string;
}

export async function editarReceta(
  id: string,
  campos: {
    titulo?: string;
    instrucciones?: string;
    categoriaId?: number | null;
    videoUrl?: string | null;
    descripcionEmplatado?: string | null;
  },
  executor: Executor = pool,
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  function agregar(columna: string, valor: unknown) {
    params.push(valor);
    sets.push(`${columna} = $${params.length}`);
  }
  if (campos.titulo !== undefined) agregar("titulo", campos.titulo);
  if (campos.instrucciones !== undefined) agregar("instrucciones", campos.instrucciones);
  if (campos.categoriaId !== undefined) agregar("categoria_id", campos.categoriaId);
  if (campos.videoUrl !== undefined) {
    agregar("video_url", campos.videoUrl);
    // Un video y una imagen principal nunca coexisten — fijar un video REAL
    // limpia la imagen principal que hubiera, en la misma sentencia (nunca
    // basta con el CHECK de la base solo: eso rechazaría el UPDATE en vez de
    // resolverlo). Vaciar el video (null) NO toca la imagen — así, cambiar a
    // la pestaña "Video" sin escribir nada y guardar no borra una imagen que
    // ya existía por accidente.
    if (campos.videoUrl) agregar("imagen_principal_url", null);
  }
  if (campos.descripcionEmplatado !== undefined) agregar("descripcion_emplatado", campos.descripcionEmplatado);
  if (sets.length === 0) return;
  params.push(id);
  await executor.query(`UPDATE recetario_recetas SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

export async function actualizarImagenPrincipal(id: string, imagenUrl: string, executor: Executor = pool) {
  // Fijar la imagen principal limpia cualquier video — nunca coexisten.
  await executor.query(`UPDATE recetario_recetas SET imagen_principal_url = $2, video_url = NULL WHERE id = $1`, [
    id,
    imagenUrl,
  ]);
}

export async function actualizarImagenEmplatado(id: string, imagenUrl: string, executor: Executor = pool) {
  await executor.query(`UPDATE recetario_recetas SET imagen_emplatado_url = $2 WHERE id = $1`, [id, imagenUrl]);
}

export async function eliminarReceta(id: string, executor: Executor = pool): Promise<boolean> {
  const result = await executor.query(`DELETE FROM recetario_recetas WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
