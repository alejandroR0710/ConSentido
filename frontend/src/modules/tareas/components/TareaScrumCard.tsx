import type { TareaScrumConParticipantes } from "../api";

interface TareaScrumCardProps {
  tarea: TareaScrumConParticipantes;
  /** true mientras esta tarjeta tiene una acción (unirse/salir/estado) en
   *  vuelo — deshabilita sus propios controles sin bloquear el resto del
   *  tablero. */
  guardando?: boolean;
  /** Root/Super Root: el backend ya les deja cambiar el estado de cualquier
   *  tarea aunque no estén unidos (tareas.gestionar, ver
   *  tareas.service.ts::cambiarEstadoTareaScrum) — sin esto, esa capacidad
   *  quedaba sin ninguna forma de usarse desde la pantalla. */
  puedeGestionar?: boolean;
  onUnirse: () => void;
  onSalir: () => void;
  /** Pasar de abierta<->en_progreso — libre, sin confirmación (reversible). */
  onCambiarEstado: (estado: "abierta" | "en_progreso") => void;
  /** Cerrar — terminal, se confirma antes de llamarlo (ver TableroPage). */
  onCerrar: () => void;
}

// Mismos tonos pastel que ESTILO_TARJETA_ESTADO en TareaCard.tsx (rutina
// diaria) — "abierta" reutiliza el ámbar de "pendiente", "en_progreso" el
// azul de ahí; "cerrada" es el verde de marca, igual que "completada".
const ESTILO_SELECT_ESTADO_SCRUM: Record<"abierta" | "en_progreso", string> = {
  abierta: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20",
  en_progreso: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20",
};

const ETIQUETA_ESTADO_SCRUM: Record<"abierta" | "en_progreso", string> = {
  abierta: "Pendiente",
  en_progreso: "En progreso",
};

/**
 * Tarjeta de una tarea del tablero compartido (Scrum): título, descripción,
 * participantes unidos y, según `estado`/`yaUnido`/`puedeGestionar`, los
 * controles disponibles. No llama la API — delega en los callbacks (quien
 * conoce el `id` de la tarea y decide cuándo refrescar; ver `TableroPage`).
 *
 * Reglas de visibilidad:
 * - `abierta`/`en_progreso` + puede actuar (unido o acceso total) -> selector
 *   Pendiente/En progreso (libre, sin confirmación) + "Cerrar" (con
 *   confirmación, es terminal — ver TableroPage). Si no está unido, además
 *   "Unirme".
 * - `abierta`/`en_progreso` + no puede actuar -> solo "Unirme".
 * - `cerrada` -> ningún control, solo la marca "✓ Cerrada" (tono verde
 *   pastel, nunca rojo — mismo criterio de `ESTILO_TARJETA_ESTADO` en
 *   `TareaCard.tsx`) y, si se sabe, quién la cerró.
 */
export function TareaScrumCard({
  tarea,
  guardando = false,
  puedeGestionar = false,
  onUnirse,
  onSalir,
  onCambiarEstado,
  onCerrar,
}: TareaScrumCardProps) {
  const cerrada = tarea.estado === "cerrada";
  const puedeActuar = tarea.yaUnido || puedeGestionar;

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700 ${
        cerrada ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">{tarea.titulo}</p>
          {tarea.descripcion && (
            <p className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">{tarea.descripcion}</p>
          )}
        </div>
        {cerrada && (
          <span className="shrink-0 rounded-md border border-brand-green-100 bg-brand-green-50 px-2 py-1 text-xs font-medium text-brand-green-700 dark:border-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
            ✓ Cerrada
          </span>
        )}
      </div>

      {cerrada && tarea.cerradoPorNombre && (
        <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
          Cerrada por {tarea.cerradoPorNombre}
          {tarea.cerradoEn && ` · ${new Date(tarea.cerradoEn).toLocaleString()}`}
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        {tarea.participantes.length === 0 ? (
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
            {cerrada ? "Nadie se unió." : "Sin participantes todavía."}
          </span>
        ) : (
          tarea.participantes.map((p) => (
            <span
              key={p.usuarioId}
              className="rounded-full bg-brand-vanilla-dark/40 px-2 py-0.5 text-xs text-brand-ink dark:bg-brand-green-700/30 dark:text-brand-vanilla"
            >
              {p.nombre}
            </span>
          ))
        )}
      </div>

      {!cerrada && (
        <div className="flex flex-wrap items-center gap-2">
          {puedeActuar && (
            <select
              value={tarea.estado as "abierta" | "en_progreso"}
              disabled={guardando}
              onChange={(e) => onCambiarEstado(e.target.value as "abierta" | "en_progreso")}
              className={`rounded-md border px-2 py-1 text-xs text-brand-ink disabled:opacity-60 dark:text-brand-vanilla ${ESTILO_SELECT_ESTADO_SCRUM[tarea.estado as "abierta" | "en_progreso"]}`}
            >
              {(Object.keys(ETIQUETA_ESTADO_SCRUM) as Array<"abierta" | "en_progreso">).map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_ESTADO_SCRUM[e]}
                </option>
              ))}
            </select>
          )}
          {tarea.yaUnido && (
            <button
              onClick={onSalir}
              disabled={guardando}
              className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs text-brand-ink disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla"
            >
              Salir
            </button>
          )}
          {!tarea.yaUnido && (
            <button
              onClick={onUnirse}
              disabled={guardando}
              className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              Unirme
            </button>
          )}
          {puedeActuar && (
            <button
              onClick={onCerrar}
              disabled={guardando}
              className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs text-brand-ink disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla"
            >
              Cerrar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
