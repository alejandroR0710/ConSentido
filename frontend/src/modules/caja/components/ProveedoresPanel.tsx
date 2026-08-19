import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { cajaApi, type Proveedor } from "../api";

interface ProveedoresPanelProps {
  onActualizar: () => void;
}

const FORMULARIO_VACIO = { nombre: "", contacto: "", telefono: "", email: "" };

const inputClase =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const labelClase = "mb-1 block text-[11px] font-medium text-brand-ink/70 dark:text-brand-vanilla/70";

export function ProveedoresPanel({ onActualizar }: ProveedoresPanelProps) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [formulario, setFormulario] = useState(FORMULARIO_VACIO);
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

  function cancelar() {
    setEditando(null);
    setFormulario(FORMULARIO_VACIO);
  }

  async function guardar() {
    if (!formulario.nombre.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await cajaApi.actualizarProveedor(editando, formulario.nombre, formulario.contacto, formulario.telefono, formulario.email);
      } else {
        await cajaApi.crearProveedor(formulario.nombre, formulario.contacto, formulario.telefono, formulario.email);
      }
      cancelar();
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
    setError(null);
    try {
      await cajaApi.desactivarProveedor(id);
      if (id === editando) cancelar();
      await cargarProveedores();
      onActualizar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el proveedor");
    }
  }

  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla sm:text-base">Proveedores</h3>
        {proveedores.length > 0 && (
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">{proveedores.length}</span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>
      )}

      {/* Formulario crear/editar */}
      <div
        className={`mb-4 rounded-md border p-3 ${
          editando
            ? "border-brand-green-600 bg-brand-green-50/50 dark:border-brand-green-500 dark:bg-brand-green-700/10"
            : "border-brand-vanilla-dark dark:border-brand-green-700"
        }`}
      >
        {editando && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla">
              ✎ Editando proveedor
            </span>
            <button
              type="button"
              onClick={cancelar}
              className="text-xs text-brand-ink/60 underline hover:text-brand-ink dark:text-brand-vanilla/60 dark:hover:text-brand-vanilla"
            >
              Cancelar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClase}>Nombre *</label>
            <input
              value={formulario.nombre}
              onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && guardar()}
              placeholder="Ej. Distribuidora ABC"
              className={inputClase}
            />
          </div>
          <div>
            <label className={labelClase}>Contacto</label>
            <input
              value={formulario.contacto}
              onChange={(e) => setFormulario({ ...formulario, contacto: e.target.value })}
              placeholder="Ej. Juan Pérez"
              className={inputClase}
            />
          </div>
          <div>
            <label className={labelClase}>Teléfono</label>
            <input
              value={formulario.telefono}
              onChange={(e) => setFormulario({ ...formulario, telefono: e.target.value })}
              placeholder="Ej. 300 123 4567"
              className={inputClase}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClase}>Email</label>
            <input
              type="email"
              value={formulario.email}
              onChange={(e) => setFormulario({ ...formulario, email: e.target.value })}
              placeholder="correo@proveedor.com"
              className={inputClase}
            />
          </div>
        </div>

        <button
          onClick={guardar}
          disabled={guardando || !formulario.nombre.trim()}
          className="mt-3 w-full rounded-md bg-brand-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : editando ? "Guardar cambios" : "+ Agregar proveedor"}
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : proveedores.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin proveedores aún.</p>
      ) : (
        <div className="space-y-1.5">
          {proveedores.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between gap-2 rounded-md p-2 ${
                p.id === editando
                  ? "bg-brand-green-100 dark:bg-brand-green-700/40"
                  : "bg-brand-green-50 dark:bg-brand-green-700/20"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">{p.nombre}</div>
                {(p.contacto || p.telefono || p.email) && (
                  <div className="truncate text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                    {[p.contacto, p.telefono, p.email].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
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
                  aria-label="Editar proveedor"
                  title="Editar"
                  className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-100 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                >
                  ✎
                </button>
                <button
                  onClick={() => eliminar(p.id)}
                  aria-label="Eliminar proveedor"
                  title="Eliminar"
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
