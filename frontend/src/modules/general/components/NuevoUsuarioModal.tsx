import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useAuth } from "../../../shared/auth/useAuth";
import { Modal } from "../../../shared/components/Modal";
import { usuariosApi, type Rol, type TipoIdentificador } from "../api";

interface NuevoUsuarioModalProps {
  roles: Rol[];
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

const campoClase =
  "w-full rounded-lg border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/20 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";
const seccionClase =
  "mb-3 rounded-xl border border-brand-green-100 bg-brand-green-50/60 p-3 dark:border-brand-green-700/50 dark:bg-brand-green-700/10";
const tituloSeccionClase =
  "mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla/70";

const ROLES_PROTEGIDOS = new Set(["Root", "Super Root"]);

/** Alta de un usuario del equipo. Solo Super Root puede asignar el rol Root o
 *  Super Root — si quien crea es Root, esos roles ni siquiera aparecen en la
 *  lista (el backend igual lo bloquea si se intenta forzar por API). */
export function NuevoUsuarioModal({ roles, onCerrar, onCreado }: NuevoUsuarioModalProps) {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";
  const rolesDisponibles = esSuperRoot ? roles : roles.filter((r) => !ROLES_PROTEGIDOS.has(r.nombre));

  const [nombre, setNombre] = useState("");
  const [tipoIdentificador, setTipoIdentificador] = useState<TipoIdentificador>("email");
  const [identificador, setIdentificador] = useState("");
  const [password, setPassword] = useState("");
  const [rolId, setRolId] = useState<number | "">("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identificadorValido =
    tipoIdentificador === "email" ? /\S+@\S+\.\S+/.test(identificador.trim()) : identificador.trim().length >= 3;
  const puedeGuardar = nombre.trim().length >= 2 && identificadorValido && password.length >= 8 && rolId !== "";

  async function crear() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await usuariosApi.crear({
        nombre: nombre.trim(),
        tipoIdentificador,
        identificador: identificador.trim(),
        password,
        rolId: Number(rolId),
      });
      await onCreado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo usuario" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>👤</span> Datos de acceso
        </p>
        <label className={etiquetaClase}>Nombre</label>
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej. María González"
          className={`${campoClase} mb-3`}
        />

        <label className={etiquetaClase}>Iniciar sesión con</label>
        <select
          value={tipoIdentificador}
          onChange={(e) => setTipoIdentificador(e.target.value as TipoIdentificador)}
          className={`${campoClase} mb-2`}
        >
          <option value="email">Correo</option>
          <option value="documento">Número de documento</option>
        </select>
        <input
          type={tipoIdentificador === "email" ? "email" : "text"}
          value={identificador}
          onChange={(e) => setIdentificador(e.target.value)}
          placeholder={tipoIdentificador === "email" ? "ejemplo@correo.com" : "Ej. 1020304050"}
          className={`${campoClase} mb-3`}
        />

        <label className={etiquetaClase}>Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          className={campoClase}
        />
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>🔑</span> Rol
        </p>
        <select
          value={rolId}
          onChange={(e) => setRolId(e.target.value ? Number(e.target.value) : "")}
          className={campoClase}
        >
          <option value="">Selecciona un rol...</option>
          {rolesDisponibles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
        {!esSuperRoot && (
          <p className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Solo Super Root puede crear cuentas Root o Super Root.
          </p>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={crear}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-lg bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla transition hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Creando..." : "Crear usuario"}
      </button>
    </Modal>
  );
}
