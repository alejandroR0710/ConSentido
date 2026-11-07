import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { cerrarTarea, listarTablero, salirDeTarea, unirseATarea, type TareaScrumConParticipantes } from "../api";
import { TareaScrumCard } from "../components/TareaScrumCard";

function fechaISOHoy(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

interface Columna {
  area: string;
  tareas: TareaScrumConParticipantes[];
}

/** Agrupa las tareas del tablero por `area`, en orden alfabético (el backend
 *  no garantiza un orden de áreas particular). */
function agruparPorArea(tareas: TareaScrumConParticipantes[]): Columna[] {
  const areas = Array.from(new Set(tareas.map((t) => t.area))).sort((a, b) => a.localeCompare(b));
  return areas.map((area) => ({ area, tareas: tareas.filter((t) => t.area === area) }));
}

/**
 * "Tablero": tareas compartidas del día (tipo Scrum), agrupadas por área,
 * con unirse/salir/cerrar. Sin ruta de menú todavía (la agrega Task 8,
 * junto con el resto de páginas de este módulo, en
 * `modules-meta.ts`/`App.tsx`) — este componente no depende de eso.
 */
export function TableroPage() {
  const [fecha, setFecha] = useState(fechaISOHoy());
  const [tareas, setTareas] = useState<TareaScrumConParticipantes[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // id de la tarea con una acción (unirse/salir/cerrar) en vuelo — solo esa
  // tarjeta se deshabilita, el resto del tablero sigue siendo interactivo.
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  async function cargar() {
    try {
      setTareas(await listarTablero(fecha));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el tablero");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  async function onUnirse(id: string) {
    setGuardandoId(id);
    try {
      await unirseATarea(id);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo unir a la tarea");
    } finally {
      setGuardandoId(null);
    }
  }

  async function onSalir(id: string) {
    setGuardandoId(id);
    try {
      await salirDeTarea(id);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo salir de la tarea");
    } finally {
      setGuardandoId(null);
    }
  }

  async function onCerrar(id: string) {
    setGuardandoId(id);
    try {
      await cerrarTarea(id);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la tarea");
    } finally {
      setGuardandoId(null);
    }
  }

  const columnas = agruparPorArea(tareas);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Tablero</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Tareas compartidas del día por área: únete, sal o cierra las que correspondan.
          </p>
        </div>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : tareas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60">
          No hay tareas en el tablero para este día.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {columnas.map((columna) => (
            <div key={columna.area} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
                {columna.area} <span className="text-brand-ink/50 dark:text-brand-vanilla/50">({columna.tareas.length})</span>
              </h2>
              <div className="flex flex-col gap-3">
                {columna.tareas.map((tarea) => (
                  <TareaScrumCard
                    key={tarea.id}
                    tarea={tarea}
                    guardando={guardandoId === tarea.id}
                    onUnirse={() => onUnirse(tarea.id)}
                    onSalir={() => onSalir(tarea.id)}
                    onCerrar={() => onCerrar(tarea.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
