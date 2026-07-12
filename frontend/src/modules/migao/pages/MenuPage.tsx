import { useEffect, useState } from "react";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { migaoApi, type CategoriaProducto, type ProductoAdmin } from "../api";
import { EditarProductoModal } from "../components/EditarProductoModal";
import { NuevoProductoModal } from "../components/NuevoProductoModal";

const SIN_CATEGORIA = "Sin categoría";

function agruparPorCategoria(productos: ProductoAdmin[]): [string, ProductoAdmin[]][] {
  const grupos = new Map<string, ProductoAdmin[]>();
  for (const p of productos) {
    const clave = p.categoria_nombre ?? SIN_CATEGORIA;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(p);
  }
  // "Sin categoría" al final, el resto ya viene ordenado alfabéticamente desde el backend.
  return Array.from(grupos.entries()).sort(([a], [b]) => {
    if (a === SIN_CATEGORIA) return 1;
    if (b === SIN_CATEGORIA) return -1;
    return a.localeCompare(b);
  });
}

export function MenuPage() {
  const [productos, setProductos] = useState<ProductoAdmin[]>([]);
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [productoEditando, setProductoEditando] = useState<ProductoAdmin | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const [listaProductos, listaCategorias] = await Promise.all([
        migaoApi.listarProductosAdmin(),
        migaoApi.listarCategorias(),
      ]);
      setProductos(listaProductos);
      setCategorias(listaCategorias);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el menú");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function agregarCategoria(categoria: CategoriaProducto) {
    setCategorias((actual) => [...actual, categoria].sort((a, b) => a.nombre.localeCompare(b.nombre)));
  }

  const grupos = agruparPorCategoria(productos);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Menú</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Productos disponibles para agregar a las órdenes en Mesero, organizados por categoría.
          </p>
        </div>
        <button
          onClick={() => setNuevoAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo producto
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : productos.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Aún no hay productos en el menú.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {grupos.map(([categoria, items]) => (
            <div key={categoria}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla">
                {categoria}
              </h2>
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[320px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2"></th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Precio</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                          p.activo ? "" : "opacity-50"
                        }`}
                      >
                        <td className="px-3 py-2">
                          {resolveImageUrl(p.imagen_url) ? (
                            <img
                              src={resolveImageUrl(p.imagen_url)!}
                              alt=""
                              className="h-10 w-10 rounded-md border border-brand-vanilla-dark object-cover dark:border-brand-green-700"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md border border-dashed border-brand-vanilla-dark dark:border-brand-green-700" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {p.nombre}
                          {p.descripcion && (
                            <details className="mt-1">
                              <summary className="cursor-pointer select-none text-xs text-brand-green-700 dark:text-brand-vanilla/80">
                                Descripción
                              </summary>
                              <p className="mt-1 max-w-xs text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                                {p.descripcion}
                              </p>
                            </details>
                          )}
                        </td>
                        <td className="px-3 py-2">{formatMoney(p.precio)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              p.activo ? "bg-brand-green-50 text-brand-green-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {p.activo ? "activo" : "eliminado"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => setProductoEditando(p)}
                            aria-label="Editar producto"
                            className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs dark:border-brand-green-700"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {nuevoAbierto && (
        <NuevoProductoModal
          categorias={categorias}
          onCerrar={() => setNuevoAbierto(false)}
          onCreado={cargar}
          onCategoriaCreada={agregarCategoria}
        />
      )}

      {productoEditando && (
        <EditarProductoModal
          producto={productoEditando}
          categorias={categorias}
          onCerrar={() => setProductoEditando(null)}
          onGuardado={cargar}
          onCategoriaCreada={agregarCategoria}
        />
      )}
    </div>
  );
}
