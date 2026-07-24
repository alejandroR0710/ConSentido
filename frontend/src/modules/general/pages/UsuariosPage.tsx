import { useEffect, useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { usuariosApi, type Rol, type Usuario } from "../api";
import { EditarUsuarioModal } from "../components/EditarUsuarioModal";
import { NuevoUsuarioModal } from "../components/NuevoUsuarioModal";

const POLL_MS = 20000;

function formatFecha(fechaIso: string | null) {
  if (!fechaIso) return "Nunca";
  return new Date(fechaIso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

/** Gestor de usuarios: exclusivo de Root/Super Root (ver modules-meta.ts y el
 *  permiso general.usuarios.* en el backend). Root ve y puede editar/crear
 *  cualquier cuenta, EXCEPTO otras cuentas Root/Super Root — eso lo valida el
 *  backend (usuarios.service.ts) y esta pantalla lo refleja ocultando/
 *  bloqueando esas acciones para no ofrecer un botón que va a fallar. */
export function UsuariosPage() {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);

  async function cargar() {
    try {
      const [listaUsuarios, listaRoles] = await Promise.all([usuariosApi.listar(), usuariosApi.listarRoles()]);
      setUsuarios(listaUsuarios);
      setRoles(listaRoles);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de usuarios");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRegistrarRefresco(cargar);

  const usuariosFiltrados = usuarios.filter(
    (u) =>
      u.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) ||
      u.email.toLowerCase().includes(busqueda.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Usuarios</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Crea, edita o desactiva las cuentas del equipo y su rol de acceso.
          </p>
        </div>
        <button
          onClick={() => setNuevoAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo usuario
        </button>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre o correo..."
        className="w-full max-w-sm rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : usuariosFiltrados.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Sin resultados{busqueda && ` para "${busqueda}"`}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Correo</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Último ingreso</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.map((u) => {
                const esProtegido = !esSuperRoot && (u.rol_nombre === "Root" || u.rol_nombre === "Super Root");
                const esUnoMismo = u.id === usuario?.id;
                return (
                  <tr
                    key={u.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${!u.activo ? "opacity-50" : ""}`}
                  >
                    <td className="px-3 py-2">
                      {u.nombre}
                      {esUnoMismo && (
                        <span className="ml-2 rounded-full bg-brand-green-100 px-2 py-0.5 text-xs text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                          tú
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.rol_nombre}</td>
                    <td className="px-3 py-2 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                      {formatFecha(u.ultimo_login)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.activo ? "bg-brand-green-50 text-brand-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.activo ? "activo" : "inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setUsuarioEditando(u)}
                        aria-label="Editar usuario"
                        className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs dark:border-brand-green-700"
                      >
                        {esProtegido ? "Ver" : "Editar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nuevoAbierto && <NuevoUsuarioModal roles={roles} onCerrar={() => setNuevoAbierto(false)} onCreado={cargar} />}

      {usuarioEditando && (
        <EditarUsuarioModal
          usuario={usuarioEditando}
          roles={roles}
          onCerrar={() => setUsuarioEditando(null)}
          onGuardado={cargar}
        />
      )}
    </div>
  );
}
