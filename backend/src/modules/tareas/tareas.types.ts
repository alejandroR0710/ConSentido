/**
 * Módulo Tareas / Rutina diaria.
 *
 * `PlantillaTarea` es la regla (qué tarea, para quién, cuándo aplica);
 * `InstanciaTarea` es la ocurrencia concreta de esa regla para un usuario y
 * una fecha, con su propio estado. Ver migración
 * `database/mysql/migraciones/2026-11-03_modulo_tareas.sql` para las tablas.
 */

export type EstadoTarea = "pendiente" | "en_progreso" | "completada" | "omitida";

export interface PlantillaTarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  /** Exactamente uno de rolId/usuarioId está presente (lo garantiza un CHECK en la DB). */
  rolId: number | null;
  usuarioId: string | null;
  tipoRecurrencia: "semanal" | "unica";
  /** 1=lunes..7=domingo. Presente solo si tipoRecurrencia es 'semanal'. */
  diasSemana: number[] | null;
  /** Presente solo si tipoRecurrencia es 'unica'. */
  fechaUnica: string | null;
  orden: number;
  activo: boolean;
}

export interface InstanciaTarea {
  id: string;
  plantillaId: string;
  usuarioId: string;
  fecha: string;
  estado: EstadoTarea;
  /** Vía JOIN a la plantilla — la pantalla nunca necesita pedirlos aparte. */
  titulo: string;
  descripcion: string | null;
  actualizadoPorId: string | null;
  actualizadoEn: string | null;
  /**
   * true cuando la fila es una PREVISUALIZACIÓN (fecha futura): se calculó a
   * partir de las plantillas aplicables, pero no existe todavía como fila
   * real en `tareas_instancia` — se genera recién cuando llegue ese día (ver
   * obtenerTareasDelDia/obtenerVistaCruzada en tareas.service.ts). El
   * frontend no debe permitir cambiar el estado de una fila con esta
   * bandera, no hay una instancia real a la que escribirle.
   */
  vistaPrevia?: boolean;
}

export interface InstanciaVistaCruzada extends InstanciaTarea {
  usuarioNombre: string;
}

// ---------------------------------------------------------------------------
// Tablero compartido por área (tipo Scrum): tarea suelta con un solo estado
// compartido entre quienes se unan. Ver migraciones
// `database/mysql/migraciones/2026-11-07_tareas_scrum.sql` y
// `2026-11-07b_tareas_scrum_en_progreso.sql` para las tablas.
// ---------------------------------------------------------------------------

/** 'cerrada' es terminal: nunca se vuelve a abierta/en_progreso desde ahí
 *  (ver tareas.service.ts::cambiarEstadoTareaScrum). */
export type EstadoTareaScrum = "abierta" | "en_progreso" | "cerrada";

export interface TareaScrum {
  id: string;
  titulo: string;
  area: string;
  descripcion: string | null;
  fecha: string;
  estado: EstadoTareaScrum;
  creadoPorId: string;
  cerradoPorId: string | null;
  cerradoEn: string | null;
  /** Nombre de quien la cerró, vía JOIN — null si nunca se cerró. */
  cerradoPorNombre: string | null;
}

export interface ParticipanteScrum {
  usuarioId: string;
  nombre: string;
}
