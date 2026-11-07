import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import {
  cambiarEstadoTareaScrum,
  listarTablero,
  salirDeTarea,
  unirseATarea,
  type TareaScrumConParticipantes,
} from "../api";
import { NuevaTareaScrumModal } from "../components/NuevaTareaScrumModal";
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
  const { usuario } = useAuth();
  // El backend ya deja a Root/Super Root cerrar cualquier tarea sin estar
  // unidos (tareas.gestionar, ver tareas.service.ts::cerrarTareaScrum) —
  // esto es lo que le da a esa capacidad una forma de usarse desde la pantalla.
  const puedeGestionar = tieneAccesoTotal(usuario?.rol);
  const [fecha, setFecha] = useState(fechaISOHoy());
  const [tareas, setTareas] = useState<TareaScrumConParticipantes[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // id de la tarea con una acción (unirse/salir/cerrar) en vuelo — solo esa
  // tarjeta se deshabilita, el resto del tablero sigue siendo interactivo.
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [mostrarNuevaTarea, setMostrarNuevaTarea] = useState(false);

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
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo unir a la tarea");
    } finally {
      // Siempre, también si falló (ej. otro usuario ya cerró esta tarea
      // mientras tanto) — si no, la tarjeta se queda mostrando un estado
      // viejo hasta que algo más la recargue.
      await cargar();
      setGuardandoId(null);
    }
  }

  async function onSalir(id: string) {
    setGuardandoId(id);
    try {
      await salirDeTarea(id);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo salir de la tarea");
    } finally {
      await cargar();
      setGuardandoId(null);
    }
  }

  // Pasar entre abierta/en_progreso es libre y reversible — sin confirmación.
  async function onCambiarEstado(id: string, estado: "abierta" | "en_progreso") {
    setGuardandoId(id);
    try {
      await cambiarEstadoTareaScrum(id, estado);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado de la tarea");
    } finally {
      await cargar();
      setGuardandoId(null);
    }
  }

  async function onCerrar(id: string) {
    // Cerrar es compartido e irreversible desde esta pantalla (no hay botón
    // para reabrir) — un toque de más no debería cerrarla por accidente.
    if (!confirm("¿Cerrar esta tarea? Quedará cerrada para todos los que participan, no se puede deshacer.")) return;
    setGuardandoId(id);
    try {
      await cambiarEstadoTareaScrum(id, "cerrada");
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la tarea");
    } finally {
      await cargar();
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
        <div className="flex items-center gap-2">
          {puedeGestionar && (
            <button
              onClick={() => setMostrarNuevaTarea(true)}
              className="rounded-md bg-brand-green-700 px-3 py-1.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
            >
              + Nueva tarea
            </button>
          )}
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
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
                    puedeGestionar={puedeGestionar}
                    onUnirse={() => onUnirse(tarea.id)}
                    onSalir={() => onSalir(tarea.id)}
                    onCambiarEstado={(estado) => onCambiarEstado(tarea.id, estado)}
                    onCerrar={() => onCerrar(tarea.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mostrarNuevaTarea && (
        <NuevaTareaScrumModal
          areasSugeridas={columnas.map((columna) => columna.area)}
          onCerrar={() => setMostrarNuevaTarea(false)}
          onCreada={cargar}
        />
      )}
    </div>
  );
}
