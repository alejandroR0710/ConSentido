import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { EditarRecetaModal } from "../components/EditarRecetaModal";
import { NuevaRecetaModal } from "../components/NuevaRecetaModal";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

export function RecetarioAdminPage() {
  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [categorias, setCategorias] = useState<RecetarioCategoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [recetaEditando, setRecetaEditando] = useState<Receta | null>(null);

  async function cargar() {
    try {
      const [r, c] = await Promise.all([recetarioApi.listar(), recetarioApi.listarCategorias()]);
      setRecetas(r);
      setCategorias(c);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las recetas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function onCategoriaCreada(categoria: RecetarioCategoria) {
    setCategorias((actual) => [...actual, categoria].sort((a, b) => a.nombre.localeCompare(b.nombre)));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Recetario</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Recetas que ve el equipo de cocina en "Recetas".
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nueva receta
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : recetas.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Todavía no hay recetas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Título</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Medio</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {recetas.map((r) => (
                <tr key={r.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                  <td className="px-3 py-2 font-medium text-brand-ink dark:text-brand-vanilla">{r.titulo}</td>
                  <td className="px-3 py-2">{r.categoria_nombre ?? "—"}</td>
                  <td className="px-3 py-2">{r.video_url ? "🎬 Video" : r.imagen_principal_url ? "🖼️ Imagen" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setRecetaEditando(r)}
                      className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevaRecetaModal
          categorias={categorias}
          onCerrar={() => setModalAbierto(false)}
          onCreado={async () => {
            setModalAbierto(false);
            await cargar();
          }}
          onCategoriaCreada={onCategoriaCreada}
        />
      )}

      {recetaEditando && (
        <EditarRecetaModal
          receta={recetaEditando}
          categorias={categorias}
          onCerrar={() => setRecetaEditando(null)}
          onGuardado={async () => {
            setRecetaEditando(null);
            await cargar();
          }}
          onMediaActualizada={cargar}
          onCategoriaCreada={onCategoriaCreada}
        />
      )}
    </div>
  );
}
