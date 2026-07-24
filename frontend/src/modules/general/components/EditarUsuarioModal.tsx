import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useAuth } from "../../../shared/auth/useAuth";
import { Modal } from "../../../shared/components/Modal";
import { usuariosApi, type Rol, type TipoIdentificador, type Usuario } from "../api";

interface EditarUsuarioModalProps {
  usuario: Usuario;
  roles: Rol[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

const campoClase =
  "w-full rounded-lg border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/20 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";
const seccionClase =
  "mb-3 rounded-xl border border-brand-green-100 bg-brand-green-50/60 p-3 dark:border-brand-green-700/50 dark:bg-brand-green-700/10";
const tituloSeccionClase =
  "mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla/70";

const ROLES_PROTEGIDOS = new Set(["Root", "Super Root"]);

export function EditarUsuarioModal({ usuario: objetivo, roles, onCerrar, onGuardado }: EditarUsuarioModalProps) {
  const { usuario: actor } = useAuth();
  const esSuperRoot = actor?.rol === "Super Root";
  const esUnoMismo = objetivo.id === actor?.id;
  // Root no puede ni ver el formulario de edición de otro Root/Super Root — el
  // backend lo bloquearía igual, pero mostrarle campos editables que van a
  // fallar con un 403 es peor experiencia que directamente no ofrecerlos.
  const esProtegido = !esSuperRoot && ROLES_PROTEGIDOS.has(objetivo.rol_nombre);
  const rolesDisponibles = esSuperRoot ? roles : roles.filter((r) => !ROLES_PROTEGIDOS.has(r.nombre));

  const [nombre, setNombre] = useState(objetivo.nombre);
  const [tipoIdentificador, setTipoIdentificador] = useState<TipoIdentificador>(
    objetivo.numero_documento ? "documento" : "email",
  );
  const [identificador, setIdentificador] = useState(objetivo.email ?? objetivo.numero_documento ?? "");
  const [password, setPassword] = useState("");
  const [rolId, setRolId] = useState(objetivo.rol_id);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identificadorValido =
    tipoIdentificador === "email" ? /\S+@\S+\.\S+/.test(identificador.trim()) : identificador.trim().length >= 3;
  const puedeGuardar = nombre.trim().length >= 2 && identificadorValido;
  const bloqueado = guardando || cambiandoEstado || eliminando;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await usuariosApi.editar(objetivo.id, {
        nombre: nombre.trim(),
        tipoIdentificador,
        identificador: identificador.trim(),
        rolId: rolId !== objetivo.rol_id ? rolId : undefined,
        password: password.trim() ? password : undefined,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el usuario");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo() {
    setCambiandoEstado(true);
    setError(null);
    try {
      await usuariosApi.editar(objetivo.id, { activo: !objetivo.activo });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function eliminar() {
    setEliminando(true);
    setError(null);
    try {
      await usuariosApi.eliminar(objetivo.id);
      await onGuardado();
      onCerrar();
    } catch (err) {
      setConfirmandoEliminar(false);
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el usuario");
    } finally {
      setEliminando(false);
    }
  }

  if (esProtegido) {
    return (
      <Modal titulo="Cuenta protegida" onCerrar={onCerrar} maxWidth="sm:max-w-sm">
        <p className="text-sm text-brand-ink dark:text-brand-vanilla">
          <span className="font-semibold">"{objetivo.nombre}"</span> es una cuenta {objetivo.rol_nombre}. Solo Super
          Root puede ver o editar los detalles de esta cuenta.
        </p>
      </Modal>
    );
  }

  return (
    <Modal titulo="Editar usuario" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>👤</span> Datos de acceso
        </p>
        <label className={etiquetaClase}>Nombre</label>
        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${campoClase} mb-3`} />

        <label className={etiquetaClase}>Iniciar sesión con</label>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTipoIdentificador("email")}
            className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
              tipoIdentificador === "email"
                ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
            }`}
          >
            ✉️ Correo
          </button>
          <button
            type="button"
            onClick={() => setTipoIdentificador("documento")}
            className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
              tipoIdentificador === "documento"
                ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
            }`}
          >
            🪪 Documento
          </button>
        </div>
        <input
          type={tipoIdentificador === "email" ? "email" : "text"}
          value={identificador}
          onChange={(e) => setIdentificador(e.target.value)}
          placeholder={tipoIdentificador === "email" ? "ejemplo@correo.com" : "Ej. 1020304050"}
          className={`${campoClase} mb-3`}
        />

        <label className={etiquetaClase}>Nueva contraseña (opcional)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Dejar en blanco para no cambiarla"
          className={campoClase}
        />
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>🔑</span> Rol
        </p>
        <select value={rolId} onChange={(e) => setRolId(Number(e.target.value))} className={campoClase}>
          {rolesDisponibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        {!esSuperRoot && (
          <p className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Solo Super Root puede asignar el rol Root o Super Root.
          </p>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !puedeGuardar}
        className="w-full rounded-lg bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla transition hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      {esUnoMismo ? (
        <p className="mt-4 text-center text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          No puedes desactivar ni eliminar tu propia cuenta.
        </p>
      ) : (
        <div className="my-4 border-t border-dashed border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600/80">⚠ Zona de riesgo</p>

          <button
            onClick={toggleActivo}
            disabled={bloqueado}
            className={
              objetivo.activo
                ? "mb-2 w-full rounded-lg border border-red-300 px-4 py-3 font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                : "mb-2 w-full rounded-lg border border-brand-green-700 px-4 py-3 font-medium text-brand-green-700 transition hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
            }
          >
            {cambiandoEstado ? "Actualizando..." : objetivo.activo ? "Desactivar" : "Reactivar cuenta"}
          </button>

          <button
            onClick={() => setConfirmandoEliminar(true)}
            disabled={bloqueado}
            className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            Eliminar usuario
          </button>
        </div>
      )}

      {confirmandoEliminar && (
        <Modal titulo="Eliminar usuario" onCerrar={() => !eliminando && setConfirmandoEliminar(false)} maxWidth="sm:max-w-sm">
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
            ¿Seguro que quieres eliminar a <span className="font-semibold">"{objetivo.nombre}"</span>? Esta acción no
            se puede deshacer. Si ya tiene actividad registrada (órdenes, movimientos de caja, etc.), la eliminación
            se rechazará y deberás usar "Desactivar" en su lugar.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoEliminar(false)}
              disabled={eliminando}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium disabled:opacity-60 dark:border-brand-green-700"
            >
              Cancelar
            </button>
            <button
              onClick={eliminar}
              disabled={eliminando}
              className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {eliminando ? "Eliminando..." : "Sí, eliminar"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
