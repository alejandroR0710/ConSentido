import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

export function RecetarioVerPage() {
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [categorias, setCategorias] = useState<RecetarioCategoria[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([recetarioApi.listar(), recetarioApi.listarCategorias()])
      .then(([r, c]) => {
        setRecetas(r);
        setCategorias(c);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las recetas"))
      .finally(() => setLoading(false));
  }, []);

  const recetasFiltradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return recetas.filter((r) => {
      if (categoriaFiltro !== null && r.categoria_id !== categoriaFiltro) return false;
      if (texto && !r.titulo.toLowerCase().includes(texto)) return false;
      return true;
    });
  }, [recetas, busqueda, categoriaFiltro]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Recetas</h1>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar receta..."
        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-4 py-3 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {categorias.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoriaFiltro((actual) => (actual === c.id ? null : c.id))}
              className={`rounded-full border-2 px-4 py-2 text-sm font-medium transition-colors ${
                categoriaFiltro === c.id
                  ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                  : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
              }`}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : recetasFiltradas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-lg text-brand-ink/60 dark:border-brand-green-700">
          {recetas.length === 0 ? "Todavía no hay recetas." : "No se encontró ninguna receta con ese filtro."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recetasFiltradas.map((r) => (
            <Link
              key={r.id}
              to={`/recetario/ver/${r.id}`}
              className="flex flex-col overflow-hidden rounded-xl border-2 border-brand-vanilla-dark transition-colors hover:border-brand-green-600 dark:border-brand-green-700"
            >
              <div className="flex h-40 items-center justify-center bg-brand-green-50 dark:bg-brand-green-700/20">
                {r.imagen_principal_url ? (
                  <img
                    src={resolveImageUrl(r.imagen_principal_url) ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : r.video_url ? (
                  <span className="text-5xl" aria-hidden>
                    ▶
                  </span>
                ) : (
                  <span className="text-5xl" aria-hidden>
                    🍲
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 p-3">
                <span className="text-lg font-semibold text-brand-ink dark:text-brand-vanilla">{r.titulo}</span>
                {r.categoria_nombre && (
                  <span className="self-start rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    {r.categoria_nombre}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
