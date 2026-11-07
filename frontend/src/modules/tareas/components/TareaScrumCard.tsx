import type { TareaScrumConParticipantes } from "../api";

interface TareaScrumCardProps {
  tarea: TareaScrumConParticipantes;
  /** true mientras esta tarjeta tiene una acción (unirse/salir/cerrar) en
   *  vuelo — deshabilita sus propios botones sin bloquear el resto del
   *  tablero. */
  guardando?: boolean;
  onUnirse: () => void;
  onSalir: () => void;
  onCerrar: () => void;
}

/**
 * Tarjeta de una tarea del tablero compartido (Scrum): título, descripción,
 * participantes unidos y, según `estado`/`yaUnido`, las acciones
 * disponibles. No llama la API — delega en los callbacks (quien conoce el
 * `id` de la tarea y decide cuándo refrescar; ver `TableroPage`).
 *
 * Reglas de visibilidad de botones (ver brief de este Task):
 * - `abierta` + no unido  -> "Unirme".
 * - `abierta` + ya unido  -> "Salir" + "Cerrar".
 * - `cerrada`             -> ningún botón, solo la marca "Cerrada" (tono
 *   verde pastel atenuado, nunca rojo — el mismo criterio de
 *   `ESTILO_TARJETA_ESTADO` en `TareaCard.tsx`).
 */
export function TareaScrumCard({ tarea, guardando = false, onUnirse, onSalir, onCerrar }: TareaScrumCardProps) {
  const cerrada = tarea.estado === "cerrada";

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
            Cerrada
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {tarea.participantes.length === 0 ? (
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">Sin participantes todavía.</span>
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
        <div className="flex gap-2">
          {tarea.yaUnido ? (
            <>
              <button
                onClick={onSalir}
                disabled={guardando}
                className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs text-brand-ink disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla"
              >
                Salir
              </button>
              <button
                onClick={onCerrar}
                disabled={guardando}
                className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
              >
                Cerrar
              </button>
            </>
          ) : (
            <button
              onClick={onUnirse}
              disabled={guardando}
              className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              Unirme
            </button>
          )}
        </div>
      )}
    </div>
  );
}
