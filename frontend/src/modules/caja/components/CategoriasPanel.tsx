import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { cajaApi, type CategoriaGasto } from "../api";

interface CategoriasPanelProps {
  onActualizar: () => void;
}

export function CategoriasPanel({ onActualizar }: CategoriasPanelProps) {
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    cargarCategorias();
  }, []);

  async function cargarCategorias() {
    try {
      setLoading(true);
      const datos = await cajaApi.listarCategoriasGasto();
      setCategorias(datos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las categorías");
    } finally {
      setLoading(false);
    }
  }

  function cancelar() {
    setEditando(null);
    setNuevaCategoria("");
  }

  async function guardarCategoria() {
    if (!nuevaCategoria.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await cajaApi.actualizarCategoriaGasto(editando, nuevaCategoria.trim());
      } else {
        await cajaApi.crearCategoriaGasto(nuevaCategoria.trim());
      }
      cancelar();
      await cargarCategorias();
      onActualizar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la categoría");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla sm:text-base">Categorías de Gasto</h3>
        {categorias.length > 0 && (
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">{categorias.length}</span>
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
              ✎ Editando categoría
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

        <label className="mb-1 block text-[11px] font-medium text-brand-ink/70 dark:text-brand-vanilla/70">Nombre *</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ej. Servicios públicos"
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && guardarCategoria()}
            className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <button
            onClick={guardarCategoria}
            disabled={guardando || !nuevaCategoria.trim()}
            className="shrink-0 rounded-md bg-brand-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
          >
            {guardando ? "Guardando..." : editando ? "Guardar" : "+ Agregar"}
          </button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : categorias.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin categorías aún.</p>
      ) : (
        <div className="space-y-1.5">
          {categorias.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-2 rounded-md p-2 ${
                c.id === editando
                  ? "bg-brand-green-100 dark:bg-brand-green-700/40"
                  : "bg-brand-green-50 dark:bg-brand-green-700/20"
              }`}
            >
              <span className="truncate text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">{c.nombre}</span>
              <button
                onClick={() => {
                  setEditando(c.id);
                  setNuevaCategoria(c.nombre);
                }}
                aria-label="Editar categoría"
                title="Editar"
                className="shrink-0 rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-100 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                ✎
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
