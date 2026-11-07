import { apiFetch } from "../../shared/api/client";

/**
 * Cliente de los 6 endpoints del módulo Tareas / Rutina diaria (Tasks 1-4,
 * backend), montados en `/api/v1/tareas/*` (ver backend/src/app.ts), con el
 * mismo patrón de `reportes/api.ts`: `apiFetch` resuelve base URL,
 * `credentials`, token, reintento tras refresh y el parseo de `ApiError`.
 *
 * Los tipos de abajo son un espejo manual de
 * `backend/src/modules/tareas/tareas.types.ts` (no un import cruzado), igual
 * que el resto de los módulos del frontend. Las formas de body/query salen de
 * `backend/src/modules/tareas/tareas.routes.ts`.
 */

export type EstadoTarea = "pendiente" | "en_progreso" | "completada" | "omitida";

/** Espejo de `PlantillaTarea` del backend. */
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

/** Espejo de `InstanciaTarea` del backend. */
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
  /** true si la fecha es futura: vista previa calculada desde las plantillas,
   *  todavía no existe como instancia real — no se puede cambiar su estado. */
  vistaPrevia?: boolean;
}

/** Fila de `GET /vista`: la instancia más el nombre del usuario dueño (para
 *  la vista cruzada de Root/Super Root). Espejo de
 *  `obtenerVistaCruzada` en `tareas.service.ts`. */
export interface InstanciaTareaVista extends InstanciaTarea {
  usuarioNombre: string;
  /** true si la fecha es futura: es una vista previa calculada desde las
   *  plantillas, no una instancia real todavía — no se puede cambiar su
   *  estado (no hay nada en la base a lo que escribirle). */
  vistaPrevia?: boolean;
}

/** Body de `POST /plantillas` (ver `crearPlantillaSchema` en tareas.routes.ts). */
export interface CrearPlantillaDatos {
  titulo: string;
  descripcion?: string | null;
  rolId?: number | null;
  usuarioId?: string | null;
  tipoRecurrencia: "semanal" | "unica";
  diasSemana?: number[] | null;
  fechaUnica?: string | null;
  orden?: number;
}

/** Body de `PATCH /plantillas/:id` — `tipoRecurrencia` no es editable (ver `editarPlantillaSchema`). */
export interface EditarPlantillaCambios {
  titulo?: string;
  descripcion?: string | null;
  orden?: number;
  activo?: boolean;
  diasSemana?: number[] | null;
  fechaUnica?: string | null;
}

export interface FiltrosPlantillas {
  rolId?: number;
  usuarioId?: string;
}

export interface FiltrosVistaCruzada {
  rolId?: number;
  usuarioId?: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Mis tareas del día para el usuario autenticado. Sin `fecha` el backend resuelve "hoy". */
export function obtenerMisTareas(fecha?: string) {
  return apiFetch<InstanciaTarea[]>(`/tareas/mias${buildQuery({ fecha })}`);
}

/** Cambia el estado de una instancia. Solo el dueño, o quien tenga `tareas.gestionar`. */
export function cambiarEstadoTarea(id: string, estado: EstadoTarea) {
  return apiFetch<InstanciaTarea>(`/tareas/instancias/${id}/estado`, {
    method: "PATCH",
    body: { estado },
  });
}

/** Lista las plantillas (reglas), filtrables por rol o usuario. Requiere `tareas.gestionar`. */
export function listarPlantillas(filtros: FiltrosPlantillas = {}) {
  return apiFetch<PlantillaTarea[]>(`/tareas/plantillas${buildQuery({ ...filtros })}`);
}

/** Crea una plantilla. Requiere `tareas.gestionar`. */
export function crearPlantilla(datos: CrearPlantillaDatos) {
  return apiFetch<PlantillaTarea>("/tareas/plantillas", {
    method: "POST",
    body: datos,
  });
}

/** Edita una plantilla existente. Requiere `tareas.gestionar`. */
export function editarPlantilla(id: string, cambios: EditarPlantillaCambios) {
  return apiFetch<PlantillaTarea>(`/tareas/plantillas/${id}`, {
    method: "PATCH",
    body: cambios,
  });
}

/** Vista cruzada del día de varios usuarios (Root/Super Root). Requiere `tareas.gestionar`. Sin `fecha` el backend resuelve "hoy". */
export function obtenerVistaCruzada(fecha: string | undefined, filtros: FiltrosVistaCruzada = {}) {
  return apiFetch<InstanciaTareaVista[]>(`/tareas/vista${buildQuery({ fecha, ...filtros })}`);
}

// ---------------------------------------------------------------------------
// Tablero compartido por área (tipo Scrum). Espejo de los tipos de
// `tareas.types.ts` (Task 2) y de las rutas `/tareas/scrum*` (Task 4).
// ---------------------------------------------------------------------------

/** 'cerrada' es terminal: nunca se vuelve a abierta/en_progreso desde ahí. */
export type EstadoTareaScrum = "abierta" | "en_progreso" | "cerrada";

/** Espejo de `TareaScrum` del backend. */
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
  /** Nombre de quien la cerró — null si nunca se cerró. */
  cerradoPorNombre: string | null;
}

/** Espejo de `ParticipanteScrum` del backend. */
export interface ParticipanteScrum {
  usuarioId: string;
  nombre: string;
}

/** Fila de `GET /tareas/scrum`: la tarea con sus participantes y si el usuario autenticado ya está unido. */
export interface TareaScrumConParticipantes extends TareaScrum {
  participantes: ParticipanteScrum[];
  yaUnido: boolean;
}

/** Body de `POST /tareas/scrum` (ver `crearTareaScrumSchema` en tareas.routes.ts). */
export interface CrearTareaScrumDatos {
  titulo: string;
  area: string;
  descripcion?: string | null;
  fecha?: string;
}

/** Tablero del día: tareas de la fecha con participantes. Sin `fecha` el backend resuelve "hoy". Requiere `tareas.ver_propias`. */
export function listarTablero(fecha?: string) {
  return apiFetch<TareaScrumConParticipantes[]>(`/tareas/scrum${buildQuery({ fecha })}`);
}

/** Crea una tarea compartida del tablero. Requiere `tareas.gestionar`. */
export function crearTareaScrum(datos: CrearTareaScrumDatos) {
  return apiFetch<TareaScrum>("/tareas/scrum", {
    method: "POST",
    body: datos,
  });
}

/** Une al usuario autenticado a una tarea del tablero. El backend responde `{ ok: true }`. */
export function unirseATarea(id: string) {
  return apiFetch<{ ok: boolean }>(`/tareas/scrum/${id}/unirse`, { method: "POST" });
}

/** Saca al usuario autenticado de una tarea del tablero. El backend responde `{ ok: true }`. */
export function salirDeTarea(id: string) {
  return apiFetch<{ ok: boolean }>(`/tareas/scrum/${id}/salir`, { method: "POST" });
}

/** Cambia el estado de una tarea del tablero (abierta/en_progreso libremente, cerrada es terminal). Cualquier participante puede cambiarlo; quien tenga `tareas.gestionar` puede cambiar el de cualquiera. */
export function cambiarEstadoTareaScrum(id: string, estado: EstadoTareaScrum) {
  return apiFetch<TareaScrum>(`/tareas/scrum/${id}/estado`, { method: "PATCH", body: { estado } });
}
