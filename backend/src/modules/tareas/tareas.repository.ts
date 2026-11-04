import { pool } from "../../shared/db/pool";
import type { EstadoTarea, InstanciaTarea, PlantillaTarea } from "./tareas.types";

// ---------------------------------------------------------------------------
// dias_semana es un CSV libre en la columna (ej. '1,2,3'); acá vive la única
// conversión CSV ↔ number[] del módulo. Se valida 1..7 y se quitan
// duplicados tanto al leer como al escribir — no hay CHECK para esto en la
// DB, la validación vive en código (decisión de la revisión de la Tarea 1).
// ---------------------------------------------------------------------------

function diasSemanaDesdeCsv(csv: string | null): number[] | null {
  if (csv === null) return null;
  const dias = new Set<number>();
  for (const parte of csv.split(",")) {
    const n = Number(parte.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 7) dias.add(n);
  }
  return [...dias].sort((a, b) => a - b);
}

function diasSemanaACsv(dias: number[] | null): string | null {
  if (dias === null) return null;
  const unicos = new Set<number>();
  for (const n of dias) {
    if (Number.isInteger(n) && n >= 1 && n <= 7) unicos.add(n);
  }
  if (unicos.size === 0) return null;
  return [...unicos].sort((a, b) => a - b).join(",");
}

function mapPlantilla(row: any): PlantillaTarea {
  return {
    id: row.id,
    titulo: row.titulo,
    descripcion: row.descripcion,
    rolId: row.rol_id,
    usuarioId: row.usuario_id,
    tipoRecurrencia: row.tipo_recurrencia,
    diasSemana: diasSemanaDesdeCsv(row.dias_semana),
    fechaUnica: row.fecha_unica,
    orden: row.orden,
    activo: row.activo,
  };
}

function mapInstancia(row: any): InstanciaTarea {
  return {
    id: row.id,
    plantillaId: row.plantilla_id,
    usuarioId: row.usuario_id,
    fecha: row.fecha,
    estado: row.estado,
    titulo: row.titulo,
    descripcion: row.descripcion,
    actualizadoPorId: row.actualizado_por_id,
    actualizadoEn: row.actualizado_en,
  };
}

const COLUMNAS_PLANTILLA =
  "id, titulo, descripcion, rol_id, usuario_id, tipo_recurrencia, dias_semana, fecha_unica, orden, activo";

/** JOIN a tareas_plantilla: trae titulo/descripcion para no pedirlos aparte. */
const COLUMNAS_INSTANCIA = `i.id, i.plantilla_id, i.usuario_id, i.fecha, i.estado,
       p.titulo, p.descripcion, i.actualizado_por_id, i.actualizado_en`;

/**
 * Plantillas activas que aplican para `usuarioId` (con rol `rolId`) en
 * `fecha`: coincide por rol o por asignación directa al usuario, y dentro de
 * eso, por el criterio de recurrencia de cada plantilla (semanal → el día de
 * semana de `fecha` está en `dias_semana`; única → `fecha_unica = fecha`).
 */
export async function listarPlantillasAplicables(
  fecha: string,
  usuarioId: string,
  rolId: number,
): Promise<PlantillaTarea[]> {
  const result = await pool.query(
    `SELECT ${COLUMNAS_PLANTILLA}
       FROM tareas_plantilla
      WHERE activo = true
        AND (
          (rol_id = $2 OR usuario_id = $3)
          AND (
            (tipo_recurrencia = 'semanal' AND FIND_IN_SET(WEEKDAY($1) + 1, dias_semana) > 0)
            OR (tipo_recurrencia = 'unica' AND fecha_unica = $1)
          )
        )
      ORDER BY orden ASC`,
    [fecha, rolId, usuarioId],
  );
  return result.rows.map(mapPlantilla);
}

/**
 * Crea la instancia de `fecha` para cada plantilla aplicable que todavía no
 * la tenga. `ON DUPLICATE KEY UPDATE id = id` es un no-op: hace que el
 * INSERT sea idempotente (puede llamarse en cada visita del usuario a la
 * pantalla) sin lanzar error de duplicado contra el UNIQUE existente.
 */
export async function generarInstanciasFaltantes(
  plantillas: PlantillaTarea[],
  usuarioId: string,
  fecha: string,
): Promise<void> {
  for (const plantilla of plantillas) {
    await pool.query(
      `INSERT INTO tareas_instancia (plantilla_id, usuario_id, fecha)
       VALUES ($1, $2, $3)
       ON DUPLICATE KEY UPDATE id = id`,
      [plantilla.id, usuarioId, fecha],
    );
  }
}

export async function listarInstanciasDeUsuario(usuarioId: string, fecha: string): Promise<InstanciaTarea[]> {
  const result = await pool.query(
    `SELECT ${COLUMNAS_INSTANCIA}
       FROM tareas_instancia i
       JOIN tareas_plantilla p ON p.id = i.plantilla_id
      WHERE i.usuario_id = $1 AND i.fecha = $2
      ORDER BY p.orden ASC`,
    [usuarioId, fecha],
  );
  return result.rows.map(mapInstancia);
}

/** Para que el service valide dueño antes de actualizar. */
export async function obtenerInstanciaPorId(id: string): Promise<InstanciaTarea | null> {
  const result = await pool.query(
    `SELECT ${COLUMNAS_INSTANCIA}
       FROM tareas_instancia i
       JOIN tareas_plantilla p ON p.id = i.plantilla_id
      WHERE i.id = $1`,
    [id],
  );
  return result.rowCount ? mapInstancia(result.rows[0]) : null;
}

export async function actualizarEstadoInstancia(
  id: string,
  estado: EstadoTarea,
  actualizadoPorId: string,
): Promise<InstanciaTarea | null> {
  const result = await pool.query(
    `UPDATE tareas_instancia
        SET estado = $2, actualizado_por_id = $3, actualizado_en = now()
      WHERE id = $1
      RETURNING id`,
    [id, estado, actualizadoPorId],
  );
  if (!result.rowCount) return null;
  return obtenerInstanciaPorId(id);
}

export async function obtenerPlantillaPorId(id: string): Promise<PlantillaTarea | null> {
  const result = await pool.query(`SELECT ${COLUMNAS_PLANTILLA} FROM tareas_plantilla WHERE id = $1`, [id]);
  return result.rowCount ? mapPlantilla(result.rows[0]) : null;
}

export async function crearPlantilla(
  datos: Omit<PlantillaTarea, "id" | "activo"> & { creadoPorId: string },
): Promise<PlantillaTarea> {
  const result = await pool.query(
    `INSERT INTO tareas_plantilla
       (titulo, descripcion, rol_id, usuario_id, tipo_recurrencia, dias_semana, fecha_unica, orden, creado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNAS_PLANTILLA}`,
    [
      datos.titulo,
      datos.descripcion,
      datos.rolId,
      datos.usuarioId,
      datos.tipoRecurrencia,
      diasSemanaACsv(datos.diasSemana),
      datos.fechaUnica,
      datos.orden,
      datos.creadoPorId,
    ],
  );
  return mapPlantilla(result.rows[0]);
}

export async function listarPlantillas(filtros: { rolId?: number; usuarioId?: string }): Promise<PlantillaTarea[]> {
  const condiciones: string[] = [];
  const values: unknown[] = [];

  function agregar(columna: string, valor: unknown) {
    values.push(valor);
    condiciones.push(`${columna} = $${values.length}`);
  }

  if (filtros.rolId !== undefined) agregar("rol_id", filtros.rolId);
  if (filtros.usuarioId !== undefined) agregar("usuario_id", filtros.usuarioId);

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT ${COLUMNAS_PLANTILLA} FROM tareas_plantilla ${where} ORDER BY orden ASC`,
    values,
  );
  return result.rows.map(mapPlantilla);
}

export async function actualizarPlantilla(
  id: string,
  cambios: Partial<Pick<PlantillaTarea, "titulo" | "descripcion" | "orden" | "activo" | "diasSemana" | "fechaUnica">>,
): Promise<PlantillaTarea | null> {
  const sets: string[] = [];
  const values: unknown[] = [id];

  function agregar(columna: string, valor: unknown) {
    values.push(valor);
    sets.push(`${columna} = $${values.length}`);
  }

  if (cambios.titulo !== undefined) agregar("titulo", cambios.titulo);
  if (cambios.descripcion !== undefined) agregar("descripcion", cambios.descripcion);
  if (cambios.orden !== undefined) agregar("orden", cambios.orden);
  if (cambios.activo !== undefined) agregar("activo", cambios.activo);
  if (cambios.diasSemana !== undefined) agregar("dias_semana", diasSemanaACsv(cambios.diasSemana));
  if (cambios.fechaUnica !== undefined) agregar("fecha_unica", cambios.fechaUnica);

  if (sets.length === 0) return obtenerPlantillaPorId(id);

  const result = await pool.query(`UPDATE tareas_plantilla SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, values);
  if (!result.rowCount) return null;
  return obtenerPlantillaPorId(id);
}

/** Vista cruzada de Root/Super Root: instancias de `fecha` para todos los
 *  usuarios (o filtradas por rol/usuario puntual), con el nombre de cada uno. */
export async function listarInstanciasVista(
  fecha: string,
  filtros: { rolId?: number; usuarioId?: string },
): Promise<(InstanciaTarea & { usuarioNombre: string })[]> {
  const condiciones: string[] = ["i.fecha = $1"];
  const values: unknown[] = [fecha];

  function agregar(condicion: string, valor: unknown) {
    values.push(valor);
    condiciones.push(condicion.replace("?", `$${values.length}`));
  }

  if (filtros.rolId !== undefined) agregar("u.rol_id = ?", filtros.rolId);
  if (filtros.usuarioId !== undefined) agregar("i.usuario_id = ?", filtros.usuarioId);

  const result = await pool.query(
    `SELECT ${COLUMNAS_INSTANCIA}, u.nombre AS usuario_nombre
       FROM tareas_instancia i
       JOIN tareas_plantilla p ON p.id = i.plantilla_id
       JOIN usuarios u ON u.id = i.usuario_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY u.nombre ASC, p.orden ASC`,
    values,
  );
  return result.rows.map((row: any) => ({ ...mapInstancia(row), usuarioNombre: row.usuario_nombre }));
}
