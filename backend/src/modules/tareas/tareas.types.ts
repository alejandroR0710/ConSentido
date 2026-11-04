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
}
