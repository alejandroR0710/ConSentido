import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { cambiarEstadoTarea, obtenerMisTareas, type EstadoTarea, type InstanciaTarea } from "../api";
import { TareaCard } from "../components/TareaCard";

function fechaISOHoy(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

interface Columna {
  titulo: string;
  tareas: InstanciaTarea[];
}

/**
 * "Mis tareas": instancias del día del usuario autenticado, agrupadas en 3
 * columnas por estado. "omitida" no tiene columna propia — se agrupa dentro
 * de "En progreso" (ver brief de este Task); `TareaCard` sigue pintando su
 * propio color pastel por tarjeta para que las dos se distingan dentro de
 * esa columna compartida.
 *
 * Sin ruta de menú todavía (la agrega Task 8, junto con `TareasAdminPage` de
 * Task 7, en `modules-meta.ts`/`App.tsx`) — este componente no depende de
 * eso, solo se navega directo a la URL mientras tanto.
 */
export function TareasPage() {
  const [fecha, setFecha] = useState(fechaISOHoy());
  const [tareas, setTareas] = useState<InstanciaTarea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // id de la instancia con un cambio de estado en vuelo — solo esa tarjeta
  // se deshabilita, el resto de la columna sigue siendo interactiva.
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  async function cargar() {
    try {
      setTareas(await obtenerMisTareas(fecha));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las tareas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  async function onCambiarEstado(id: string, estado: EstadoTarea) {
    setGuardandoId(id);
    try {
      await cambiarEstadoTarea(id, estado);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado de la tarea");
    } finally {
      setGuardandoId(null);
    }
  }

  const columnas: Columna[] = [
    { titulo: "Pendiente", tareas: tareas.filter((t) => t.estado === "pendiente") },
    {
      titulo: "En progreso",
      tareas: tareas.filter((t) => t.estado === "en_progreso" || t.estado === "omitida"),
    },
    { titulo: "Completada", tareas: tareas.filter((t) => t.estado === "completada") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Mis tareas</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Rutina diaria asignada para la fecha seleccionada.
          </p>
        </div>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      {fecha > fechaISOHoy() && (
        <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
          Es un día futuro: esto es una vista previa de lo que te va a llegar, todavía no las puedes marcar — se
          habilita cuando llegue ese día.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : tareas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60">
          No tienes tareas asignadas para este día.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {columnas.map((columna) => (
            <div key={columna.titulo} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
                {columna.titulo} <span className="text-brand-ink/50 dark:text-brand-vanilla/50">({columna.tareas.length})</span>
              </h2>
              <div className="flex flex-col gap-3">
                {columna.tareas.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-brand-vanilla-dark p-4 text-center text-xs text-brand-ink/50 dark:border-brand-green-700 dark:text-brand-vanilla/50">
                    Sin tareas en este estado.
                  </p>
                ) : (
                  columna.tareas.map((tarea) => (
                    <TareaCard
                      key={tarea.id}
                      tarea={tarea}
                      guardando={guardandoId === tarea.id}
                      onCambiarEstado={(estado) => onCambiarEstado(tarea.id, estado)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
