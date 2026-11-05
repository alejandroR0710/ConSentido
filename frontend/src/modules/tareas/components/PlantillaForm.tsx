import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import type { Rol, Usuario } from "../../general/api";
import { crearPlantilla, editarPlantilla, type PlantillaTarea } from "../api";

interface PlantillaFormProps {
  /** null = crear una plantilla nueva; con valor = editar esa plantilla existente. */
  plantilla: PlantillaTarea | null;
  roles: Rol[];
  /** Lista completa (no solo activos) — en modo edición se usa para resolver
   *  el nombre del destino aunque ese usuario ya esté inactivo/eliminado; el
   *  selector de modo creación filtra internamente a solo asignables. */
  usuarios: Usuario[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

const DIAS_SEMANA: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: "Lun" },
  { valor: 2, etiqueta: "Mar" },
  { valor: 3, etiqueta: "Mié" },
  { valor: 4, etiqueta: "Jue" },
  { valor: 5, etiqueta: "Vie" },
  { valor: 6, etiqueta: "Sáb" },
  { valor: 7, etiqueta: "Dom" },
];

// Mismas clases que NuevoUsuarioModal/EditarUsuarioModal (general/components) —
// no se inventan estilos nuevos de formulario.
const campoClase =
  "w-full rounded-lg border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/20 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";
const seccionClase =
  "mb-3 rounded-xl border border-brand-green-100 bg-brand-green-50/60 p-3 dark:border-brand-green-700/50 dark:bg-brand-green-700/10";
const tituloSeccionClase =
  "mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla/70";

function claseOpcion(activa: boolean): string {
  return activa
    ? "rounded-md border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
    : "rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-xs font-medium text-brand-ink/70 dark:border-brand-green-700 dark:text-brand-vanilla/70";
}

/**
 * Crear/editar una plantilla de tarea (regla de rutina). Un solo componente
 * para ambos modos (ver Task 7 brief: no hay "Nueva"/"Editar" separados como
 * en Usuarios/Recetario) porque la diferencia entre modos es chica: el
 * destino (rol/usuario) y el tipo de recurrencia (semanal/única) NO son
 * editables una vez creada la plantilla (`editarPlantillaSchema` en
 * tareas.routes.ts no los acepta) — en edición se muestran como texto fijo y
 * solo el contenido del tipo ya fijado (los días, o la fecha) sigue siendo
 * editable, junto con título/descripción/activo.
 */
export function PlantillaForm({ plantilla, roles, usuarios, onCerrar, onGuardado }: PlantillaFormProps) {
  const esEdicion = plantilla !== null;

  const [titulo, setTitulo] = useState(plantilla?.titulo ?? "");
  const [descripcion, setDescripcion] = useState(plantilla?.descripcion ?? "");
  const [destino, setDestino] = useState<"rol" | "usuario">(
    plantilla ? (plantilla.rolId !== null ? "rol" : "usuario") : "rol",
  );
  const [rolId, setRolId] = useState<number | "">(plantilla?.rolId ?? "");
  const [usuarioId, setUsuarioId] = useState<string>(plantilla?.usuarioId ?? "");
  // Solo relevante en creación — en edición el tipo queda fijo al que ya
  // tenía la plantilla (tipoEfectivo abajo lo resuelve sin pasar por este
  // estado).
  const [tipoRecurrenciaNueva, setTipoRecurrenciaNueva] = useState<"semanal" | "unica">("semanal");
  const [diasSemana, setDiasSemana] = useState<number[]>(plantilla?.diasSemana ?? []);
  const [fechaUnica, setFechaUnica] = useState(plantilla?.fechaUnica ?? "");
  const [activo, setActivo] = useState(plantilla?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // En creación, el tipo lo elige el usuario (tipoRecurrenciaNueva); en
  // edición no es editable (`editarPlantillaSchema` no lo acepta — Task 2/3),
  // queda fijo al que ya tenía la plantilla.
  const tipoEfectivo = esEdicion ? plantilla!.tipoRecurrencia : tipoRecurrenciaNueva;

  // Solo usuarios que pueden recibir tareas nuevas — no tiene sentido ofrecer
  // uno inactivo/eliminado en el selector de creación (ver obtenerVistaCruzada
  // en tareas.service.ts, que tampoco les genera instancias).
  const usuariosAsignables = usuarios.filter((u) => u.activo && !u.deleted_at);

  function toggleDia(dia: number) {
    setDiasSemana((actual) =>
      actual.includes(dia) ? actual.filter((d) => d !== dia) : [...actual, dia].sort((a, b) => a - b),
    );
  }

  const destinoValido = esEdicion || (destino === "rol" ? rolId !== "" : usuarioId !== "");
  const recurrenciaValida = tipoEfectivo === "semanal" ? diasSemana.length > 0 : fechaUnica.trim().length > 0;
  const puedeGuardar = titulo.trim().length > 0 && destinoValido && recurrenciaValida;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      if (esEdicion && plantilla) {
        await editarPlantilla(plantilla.id, {
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          activo,
          // Nunca mandar el campo del OTRO tipo como ""/[] — el backend
          // rechaza fechaUnica: "" con 400 por su regex de formato (no la
          // normaliza a "no provisto" como sí hace `?fecha=` en las queries;
          // ver nota de revisión de Task 4). `undefined` se cae del JSON
          // (apiFetch usa JSON.stringify) y el campo queda sin tocar.
          diasSemana: tipoEfectivo === "semanal" ? diasSemana : undefined,
          fechaUnica: tipoEfectivo === "unica" ? fechaUnica : undefined,
        });
      } else {
        await crearPlantilla({
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || undefined,
          rolId: destino === "rol" ? Number(rolId) : undefined,
          usuarioId: destino === "usuario" ? usuarioId : undefined,
          tipoRecurrencia: tipoEfectivo,
          diasSemana: tipoEfectivo === "semanal" ? diasSemana : undefined,
          fechaUnica: tipoEfectivo === "unica" ? fechaUnica : undefined,
        });
      }
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la plantilla");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={esEdicion ? "Editar plantilla" : "Nueva plantilla"} onCerrar={onCerrar} ancho="sm:w-[32rem]">
      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>📋</span> Datos
        </p>
        <label className={etiquetaClase}>Título</label>
        <input
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Ej. Limpiar vitrina"
          className={`${campoClase} mb-3`}
        />
        <label className={etiquetaClase}>Descripción (opcional)</label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          placeholder="Detalle visible en la tarjeta de la tarea"
          className={campoClase}
        />
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>🎯</span> Asignar a
        </p>
        {esEdicion ? (
          <p className="text-sm text-brand-ink dark:text-brand-vanilla">
            {plantilla!.rolId !== null
              ? `Rol: ${roles.find((r) => r.id === plantilla!.rolId)?.nombre ?? plantilla!.rolId}`
              : `Usuario: ${usuarios.find((u) => u.id === plantilla!.usuarioId)?.nombre ?? plantilla!.usuarioId}`}
            <span className="ml-2 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">(no editable)</span>
          </p>
        ) : (
          <>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setDestino("rol")} className={claseOpcion(destino === "rol")}>
                Rol completo
              </button>
              <button
                type="button"
                onClick={() => setDestino("usuario")}
                className={claseOpcion(destino === "usuario")}
              >
                Usuario puntual
              </button>
            </div>
            {destino === "rol" ? (
              <select
                value={rolId}
                onChange={(e) => setRolId(e.target.value ? Number(e.target.value) : "")}
                className={campoClase}
              >
                <option value="">Selecciona un rol...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} className={campoClase}>
                <option value="">Selecciona un usuario...</option>
                {usuariosAsignables.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>🔁</span> Recurrencia
        </p>
        {esEdicion ? (
          <p className="mb-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            {tipoEfectivo === "semanal" ? "Semanal (tipo no editable) — ajusta los días." : "Fecha única (tipo no editable) — ajusta la fecha."}
          </p>
        ) : (
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setTipoRecurrenciaNueva("semanal")}
              className={claseOpcion(tipoEfectivo === "semanal")}
            >
              Semanal
            </button>
            <button
              type="button"
              onClick={() => setTipoRecurrenciaNueva("unica")}
              className={claseOpcion(tipoEfectivo === "unica")}
            >
              Fecha única
            </button>
          </div>
        )}

        {tipoEfectivo === "semanal" ? (
          <div className="flex flex-wrap gap-2">
            {DIAS_SEMANA.map((d) => (
              <label key={d.valor} className={claseOpcion(diasSemana.includes(d.valor))}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={diasSemana.includes(d.valor)}
                  onChange={() => toggleDia(d.valor)}
                />
                {d.etiqueta}
              </label>
            ))}
          </div>
        ) : (
          <input type="date" value={fechaUnica} onChange={(e) => setFechaUnica(e.target.value)} className={campoClase} />
        )}
      </div>

      {esEdicion && (
        <div className={seccionClase}>
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">Plantilla activa</span>
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-5 w-5 accent-brand-green-700"
            />
          </label>
          <p className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Al desactivarla deja de generar instancias nuevas de inmediato; las instancias de días pasados ya
            generadas no se borran ni se ocultan.
          </p>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-lg bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla transition hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear plantilla"}
      </button>
    </Modal>
  );
}
