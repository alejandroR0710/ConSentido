import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { usuariosApi, type Rol, type Usuario } from "../../general/api";
import {
  cambiarEstadoTarea,
  listarPlantillas,
  obtenerVistaCruzada,
  type EstadoTarea,
  type InstanciaTareaVista,
  type PlantillaTarea,
} from "../api";
import { ETIQUETA_ESTADO } from "../components/TareaCard";
import { PlantillaForm } from "../components/PlantillaForm";

const OPCIONES_ESTADO: EstadoTarea[] = ["pendiente", "en_progreso", "completada", "omitida"];

const DIA_ETIQUETA: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 7: "Dom" };

// Mismos tonos pastel que `ESTILO_TARJETA_ESTADO` en components/TareaCard.tsx
// (no exportado desde ahí) — se duplica acá nada más la paleta de colores,
// para no tocar ese archivo ya aprobado en Task 6.
const ESTILO_SELECT_ESTADO: Record<EstadoTarea, string> = {
  pendiente: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20",
  en_progreso: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20",
  completada: "border-brand-green-100 bg-brand-green-50 dark:border-brand-green-700 dark:bg-brand-green-700/20",
  omitida: "border-brand-vanilla-dark bg-brand-vanilla-dark/30 dark:border-brand-green-700 dark:bg-brand-green-900/60",
};

function fechaISOHoy(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

/** Valor de un `<select>` de filtro codificado como "" (todos), "rol-<id>" o
 *  "usuario-<id>" — más simple que repetir el par de selectores mutuamente
 *  excluyentes del formulario para un filtro de solo-lectura. */
function parseFiltro(valor: string): { rolId?: number; usuarioId?: string } {
  if (valor.startsWith("rol-")) return { rolId: Number(valor.slice(4)) };
  if (valor.startsWith("usuario-")) return { usuarioId: valor.slice("usuario-".length) };
  return {};
}

function SelectorFiltro({
  valor,
  onChange,
  roles,
  usuarios,
}: {
  valor: string;
  onChange: (valor: string) => void;
  roles: Rol[];
  usuarios: Usuario[];
}) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
    >
      <option value="">Todos</option>
      <optgroup label="Por rol">
        {roles.map((r) => (
          <option key={`rol-${r.id}`} value={`rol-${r.id}`}>
            {r.nombre}
          </option>
        ))}
      </optgroup>
      <optgroup label="Por usuario">
        {usuarios.map((u) => (
          <option key={`usuario-${u.id}`} value={`usuario-${u.id}`}>
            {u.nombre}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function etiquetaDestino(p: PlantillaTarea, roles: Rol[], usuarios: Usuario[]): string {
  if (p.rolId !== null) return `Rol: ${roles.find((r) => r.id === p.rolId)?.nombre ?? p.rolId}`;
  return `Usuario: ${usuarios.find((u) => u.id === p.usuarioId)?.nombre ?? p.usuarioId}`;
}

/** Quién hizo el último cambio de estado de una instancia y cuándo, para la
 *  columna "Actualizado" de la vista cruzada — "—" si nunca se cambió. */
function etiquetaActualizado(i: InstanciaTareaVista, usuarios: Usuario[]): string {
  if (!i.actualizadoEn) return "—";
  const nombre = usuarios.find((u) => u.id === i.actualizadoPorId)?.nombre ?? i.actualizadoPorId ?? "—";
  return `${nombre} · ${new Date(i.actualizadoEn).toLocaleString()}`;
}

function etiquetaRecurrencia(p: PlantillaTarea): string {
  if (p.tipoRecurrencia === "semanal") {
    const dias = (p.diasSemana ?? []).map((d) => DIA_ETIQUETA[d] ?? d).join(", ");
    return `Semanal: ${dias || "—"}`;
  }
  return `Única: ${p.fechaUnica ?? "—"}`;
}

/**
 * Administración de plantillas (Root/Super Root): alta/edición de reglas de
 * rutina + vista cruzada del día de todo el equipo con opción de sobreescribir
 * el estado de cualquiera. Sin gate de rol propio acá (igual que
 * UsuariosPage/RecetarioAdminPage) — el acceso real lo decide el backend
 * (permiso `tareas.gestionar`, 403 si no aplica) y qué tan visible es la
 * entrada de menú lo decide `modules-meta.ts` (Task 8, pendiente de wiring).
 */
export function TareasAdminPage() {
  const [roles, setRoles] = useState<Rol[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [errorListas, setErrorListas] = useState<string | null>(null);

  const [plantillas, setPlantillas] = useState<PlantillaTarea[]>([]);
  const [filtroPlantillasValor, setFiltroPlantillasValor] = useState("");
  const [loadingPlantillas, setLoadingPlantillas] = useState(true);
  const [errorPlantillas, setErrorPlantillas] = useState<string | null>(null);
  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [plantillaEditando, setPlantillaEditando] = useState<PlantillaTarea | null>(null);

  const [fechaVista, setFechaVista] = useState(fechaISOHoy());
  const [filtroVistaValor, setFiltroVistaValor] = useState("");
  const [vista, setVista] = useState<InstanciaTareaVista[]>([]);
  const [loadingVista, setLoadingVista] = useState(true);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const [guardandoInstanciaId, setGuardandoInstanciaId] = useState<string | null>(null);

  async function cargarListas() {
    try {
      const [listaRoles, listaUsuarios] = await Promise.all([usuariosApi.listarRoles(), usuariosApi.listar()]);
      setRoles(listaRoles);
      setUsuarios(listaUsuarios);
      setErrorListas(null);
    } catch (err) {
      setErrorListas(err instanceof ApiError ? err.message : "No se pudieron cargar roles/usuarios");
    }
  }

  async function cargarPlantillas() {
    try {
      setPlantillas(await listarPlantillas(parseFiltro(filtroPlantillasValor)));
      setErrorPlantillas(null);
    } catch (err) {
      setErrorPlantillas(err instanceof ApiError ? err.message : "No se pudieron cargar las plantillas");
    } finally {
      setLoadingPlantillas(false);
    }
  }

  async function cargarVista() {
    try {
      setVista(await obtenerVistaCruzada(fechaVista, parseFiltro(filtroVistaValor)));
      setErrorVista(null);
    } catch (err) {
      setErrorVista(err instanceof ApiError ? err.message : "No se pudo cargar la vista cruzada");
    } finally {
      setLoadingVista(false);
    }
  }

  useEffect(() => {
    cargarListas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoadingPlantillas(true);
    cargarPlantillas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroPlantillasValor]);

  useEffect(() => {
    setLoadingVista(true);
    cargarVista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaVista, filtroVistaValor]);

  // Un solo botón de "actualizar" en el header (ver RefrescoContext) — recarga
  // las tres fuentes de esta pantalla con su filtro/fecha actual.
  useRegistrarRefresco(async () => {
    await Promise.all([cargarListas(), cargarPlantillas(), cargarVista()]);
  });

  async function onCambiarEstadoVista(id: string, estado: EstadoTarea) {
    setGuardandoInstanciaId(id);
    try {
      await cambiarEstadoTarea(id, estado);
      await cargarVista();
    } catch (err) {
      setErrorVista(err instanceof ApiError ? err.message : "No se pudo actualizar el estado");
    } finally {
      setGuardandoInstanciaId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Tareas / Rutina diaria</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Administra las reglas de rutina del equipo y supervisa el estado del día de cada persona.
          </p>
        </div>
      </div>

      {errorListas && <p className="text-sm text-red-600">{errorListas}</p>}

      {/* --- Plantillas --- */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Plantillas</h2>
          <button
            onClick={() => {
              setPlantillaEditando(null);
              setFormularioAbierto(true);
            }}
            className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
          >
            + Nueva plantilla
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">Filtrar por:</span>
          <SelectorFiltro valor={filtroPlantillasValor} onChange={setFiltroPlantillasValor} roles={roles} usuarios={usuarios} />
        </div>

        {errorPlantillas && <p className="text-sm text-red-600">{errorPlantillas}</p>}

        {loadingPlantillas ? (
          <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
        ) : plantillas.length === 0 ? (
          <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
            No hay plantillas para este filtro.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Título</th>
                  <th className="px-3 py-2">Asignada a</th>
                  <th className="px-3 py-2">Recurrencia</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {plantillas.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${!p.activo ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium text-brand-ink dark:text-brand-vanilla">{p.titulo}</td>
                    <td className="px-3 py-2">{etiquetaDestino(p, roles, usuarios)}</td>
                    <td className="px-3 py-2 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                      {etiquetaRecurrencia(p)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.activo ? "bg-brand-green-50 text-brand-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {p.activo ? "activa" : "inactiva"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          setPlantillaEditando(p);
                          setFormularioAbierto(true);
                        }}
                        className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs dark:border-brand-green-700"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- Vista cruzada --- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Vista cruzada del día</h2>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={fechaVista}
            onChange={(e) => setFechaVista(e.target.value)}
            className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <span className="text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">Filtrar por:</span>
          <SelectorFiltro valor={filtroVistaValor} onChange={setFiltroVistaValor} roles={roles} usuarios={usuarios} />
        </div>

        {errorVista && <p className="text-sm text-red-600">{errorVista}</p>}

        {loadingVista ? (
          <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
        ) : vista.length === 0 ? (
          <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
            Nadie tiene tareas para este filtro/fecha.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Usuario</th>
                  <th className="px-3 py-2">Tarea</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {vista.map((i) => (
                  <tr key={i.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2 font-medium text-brand-ink dark:text-brand-vanilla">{i.usuarioNombre}</td>
                    <td className="px-3 py-2">
                      {i.titulo}
                      {i.descripcion && (
                        <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{i.descripcion}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={i.estado}
                        disabled={guardandoInstanciaId === i.id}
                        onChange={(e) => onCambiarEstadoVista(i.id, e.target.value as EstadoTarea)}
                        className={`rounded-md border px-2 py-1 text-xs text-brand-ink disabled:opacity-60 dark:text-brand-vanilla ${ESTILO_SELECT_ESTADO[i.estado]}`}
                      >
                        {OPCIONES_ESTADO.map((e) => (
                          <option key={e} value={e}>
                            {ETIQUETA_ESTADO[e]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                      {etiquetaActualizado(i, usuarios)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formularioAbierto && (
        <PlantillaForm
          plantilla={plantillaEditando}
          roles={roles}
          usuarios={usuarios}
          onCerrar={() => setFormularioAbierto(false)}
          onGuardado={async () => {
            setFormularioAbierto(false);
            await cargarPlantillas();
          }}
        />
      )}
    </div>
  );
}
