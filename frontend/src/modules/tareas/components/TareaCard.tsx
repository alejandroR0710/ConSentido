import type { EstadoTarea, InstanciaTarea } from "../api";

export const ETIQUETA_ESTADO: Record<EstadoTarea, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  omitida: "Omitida",
};

const OPCIONES_ESTADO: EstadoTarea[] = ["pendiente", "en_progreso", "completada", "omitida"];

// Tonos pastel de la plataforma (mismo criterio que `ESTILO_ESTADO` en
// pedidos/pages/PedidosPage.tsx y vales/pages/ValesPage.tsx): "completada"
// reutiliza el verde pastel de marca (brand-green-50/100), el resto toma las
// mismas familias pastel ya establecidas ahí (amber/blue) — nunca un color
// saturado nuevo. Se aplica al fondo de la tarjeta (no solo al selector)
// porque "en progreso" y "omitida" conviven en la misma columna en
// `TareasPage` — el color es lo único que las distingue a simple vista ahí.
const ESTILO_TARJETA_ESTADO: Record<EstadoTarea, string> = {
  pendiente: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20",
  en_progreso: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20",
  completada: "border-brand-green-100 bg-brand-green-50 dark:border-brand-green-700 dark:bg-brand-green-700/20",
  omitida: "border-brand-vanilla-dark bg-brand-vanilla-dark/30 dark:border-brand-green-700 dark:bg-brand-green-900/60",
};

interface TareaCardProps {
  tarea: InstanciaTarea;
  /** true mientras esta tarjeta tiene un cambio de estado en vuelo —
   *  deshabilita su propio selector sin bloquear el resto de la columna. */
  guardando?: boolean;
  onCambiarEstado: (estado: EstadoTarea) => void;
}

/**
 * Tarjeta de una instancia de tarea del día: título, descripción opcional y
 * un selector con las 4 opciones de `EstadoTarea`. No llama la API — delega
 * el cambio a `onCambiarEstado` (quien conoce el `id` de la instancia y
 * decide cuándo refrescar; ver `TareasPage`).
 */
export function TareaCard({ tarea, guardando = false, onCambiarEstado }: TareaCardProps) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 ${ESTILO_TARJETA_ESTADO[tarea.estado]}`}
    >
      <div>
        <p className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">{tarea.titulo}</p>
        {tarea.descripcion && (
          <p className="text-xs text-brand-ink/70 dark:text-brand-vanilla/70">{tarea.descripcion}</p>
        )}
      </div>
      <select
        value={tarea.estado}
        disabled={guardando}
        onChange={(e) => onCambiarEstado(e.target.value as EstadoTarea)}
        className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-xs text-brand-ink disabled:opacity-60 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        {OPCIONES_ESTADO.map((e) => (
          <option key={e} value={e}>
            {ETIQUETA_ESTADO[e]}
          </option>
        ))}
      </select>
    </div>
  );
}
