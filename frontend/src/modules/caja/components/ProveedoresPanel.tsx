import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { cajaApi, type Proveedor } from "../api";

interface ProveedoresPanelProps {
  onActualizar: () => void;
}

export function ProveedoresPanel({ onActualizar }: ProveedoresPanelProps) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [formulario, setFormulario] = useState({ nombre: "", contacto: "", telefono: "", email: "" });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    try {
      setLoading(true);
      const datos = await cajaApi.listarProveedores();
      setProveedores(datos as any);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los proveedores");
    } finally {
      setLoading(false);
    }
  }

  async function guardar() {
    if (!formulario.nombre.trim()) return;
    setGuardando(true);
    try {
      if (editando) {
        await cajaApi.actualizarProveedor(editando, formulario.nombre, formulario.contacto, formulario.telefono, formulario.email);
      } else {
        await cajaApi.crearProveedor(formulario.nombre, formulario.contacto, formulario.telefono, formulario.email);
      }
      setFormulario({ nombre: "", contacto: "", telefono: "", email: "" });
      setEditando(null);
      await cargarProveedores();
      onActualizar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el proveedor");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este proveedor?")) return;
    try {
      await cajaApi.desactivarProveedor(id);
      await cargarProveedores();
      onActualizar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el proveedor");
    }
  }

  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700 sm:p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-green-700 dark:text-brand-vanilla sm:mb-3 sm:text-base">Administrar Proveedores</h3>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex flex-col gap-2">
        <input
          type="text"
          placeholder="Nombre del proveedor"
          value={formulario.nombre}
          onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <input
          type="text"
          placeholder="Contacto (opcional)"
          value={formulario.contacto}
          onChange={(e) => setFormulario({ ...formulario, contacto: e.target.value })}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <input
          type="text"
          placeholder="Teléfono (opcional)"
          value={formulario.telefono}
          onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <input
          type="email"
          placeholder="Email (opcional)"
          value={formulario.email}
          onChange={(e) => setFormulario({ ...formulario, email: e.target.value })}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={guardar}
          disabled={guardando || !formulario.nombre.trim()}
          className="flex-1 rounded-md bg-brand-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : editando ? "Actualizar" : "Agregar"}
        </button>
        {editando && (
          <button
            onClick={() => {
              setEditando(null);
              setFormulario({ nombre: "", contacto: "", telefono: "", email: "" });
            }}
            className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-sm text-brand-ink hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            Cancelar
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : proveedores.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin proveedores aún.</p>
      ) : (
        <div className="space-y-2">
          {proveedores.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md bg-brand-green-50 p-2 dark:bg-brand-green-700/20"
            >
              <div className="flex-1">
                <div className="font-medium text-sm text-brand-green-700 dark:text-brand-vanilla">{p.nombre}</div>
                {(p.contacto || p.telefono || p.email) && (
                  <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                    {[p.contacto, p.telefono, p.email].filter(Boolean).join(" • ")}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setEditando(p.id);
                    setFormulario({
                      nombre: p.nombre,
                      contacto: p.contacto || "",
                      telefono: p.telefono || "",
                      email: p.email || "",
                    });
                  }}
                  className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-100 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                >
                  Editar
                </button>
                <button
                  onClick={() => eliminar(p.id)}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
