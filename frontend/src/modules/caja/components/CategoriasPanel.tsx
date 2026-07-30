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

  async function guardarCategoria() {
    if (!nuevaCategoria.trim()) return;
    setGuardando(true);
    try {
      if (editando) {
        await cajaApi.actualizarCategoriaGasto(editando, nuevaCategoria.trim());
        setEditando(null);
      } else {
        await cajaApi.crearCategoriaGasto(nuevaCategoria.trim());
      }
      setNuevaCategoria("");
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
      <h3 className="mb-2 text-sm font-medium text-brand-green-700 dark:text-brand-vanilla sm:mb-3 sm:text-base">Categorías de Gasto</h3>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder={editando ? "Editar categoría..." : "Nueva categoría de gasto..."}
          value={nuevaCategoria}
          onChange={(e) => setNuevaCategoria(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardarCategoria()}
          className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <button
          onClick={guardarCategoria}
          disabled={guardando || !nuevaCategoria.trim()}
          className="rounded-md bg-brand-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : editando ? "Actualizar" : "+ Agregar"}
        </button>
        {editando && (
          <button
            onClick={() => {
              setEditando(null);
              setNuevaCategoria("");
            }}
            className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-sm text-brand-ink hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            Cancelar
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : categorias.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin categorías aún.</p>
      ) : (
        <div className="space-y-1">
          {categorias.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-md bg-brand-green-50 p-2 dark:bg-brand-green-700/20"
            >
              <span className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">{c.nombre}</span>
              <button
                onClick={() => {
                  setEditando(c.id);
                  setNuevaCategoria(c.nombre);
                }}
                className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-100 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                Editar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
