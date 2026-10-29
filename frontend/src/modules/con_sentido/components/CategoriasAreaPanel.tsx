import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { conSentidoApi, type CategoriaConSentido } from "../api";

// A diferencia de CategoriasPanel.tsx (caja, que ofrece los 6 módulos), aquí
// solo existen dos áreas posibles para una categoría de producto de Con
// Sentido — ver con_sentido.repository.ts::listarCategoriasConArea.
const AREAS: { value: CategoriaConSentido["areaSlug"]; label: string }[] = [
  { value: "insumos", label: "Insumos" },
  { value: "con_sentido", label: "Con Sentido" },
];

export function CategoriasAreaPanel() {
  const [categorias, setCategorias] = useState<CategoriaConSentido[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardandoId, setGuardandoId] = useState<number | null>(null);

  useEffect(() => {
    cargarCategorias();
  }, []);

  async function cargarCategorias() {
    try {
      setLoading(true);
      const datos = await conSentidoApi.listarCategorias();
      setCategorias(datos);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las categorías");
    } finally {
      setLoading(false);
    }
  }

  // Sin botón "Guardar" aparte: el cambio en el <select> aplica de una vez,
  // mismo criterio que los demás paneles de administración de esta sesión.
  async function cambiarArea(categoria: CategoriaConSentido, areaSlug: CategoriaConSentido["areaSlug"]) {
    setGuardandoId(categoria.id);
    setError(null);
    try {
      await conSentidoApi.actualizarAreaCategoria(categoria.id, areaSlug);
      setCategorias((prev) => prev.map((c) => (c.id === categoria.id ? { ...c, areaSlug } : c)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el área");
    } finally {
      setGuardandoId(null);
    }
  }

  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla sm:text-base">
          Área de las categorías
        </h3>
        {categorias.length > 0 && (
          <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">{categorias.length}</span>
        )}
      </div>

      <p className="mb-3 text-[11px] text-brand-ink/50 dark:text-brand-vanilla/50">
        Marca qué categorías cuentan como Insumos y cuáles como Con Sentido (tienda) — define el área por defecto al
        vender o registrar un producto de esa categoría.
      </p>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : categorias.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin categorías aún.</p>
      ) : (
        <div className="space-y-1.5">
          {categorias.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-md bg-brand-green-50 p-2 dark:bg-brand-green-700/20"
            >
              <span className="min-w-0 truncate text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
                {c.nombre}
              </span>
              <select
                value={c.areaSlug}
                disabled={guardandoId === c.id}
                onChange={(e) => cambiarArea(c, e.target.value as CategoriaConSentido["areaSlug"])}
                className="shrink-0 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-xs text-brand-ink outline-none focus:border-brand-green-600 disabled:opacity-60 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              >
                {AREAS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
