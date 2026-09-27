import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { conSentidoApi, type ProductoConSentido } from "../api";

export function InventarioConSentidoPage() {
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    try {
      setProductos(await conSentidoApi.listarProductos());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el inventario");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Inventario</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Gestiona el inventario y productos de Con Sentido
          </p>
        </div>
        <Link
          to="/con-sentido"
          className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
        >
          ← Atrás
        </Link>
      </div>

      {/* El catálogo de Con Sentido viene del e-commerce (ver
          backend/src/modules/integracion_ecommerce): los productos se crean y
          editan allá, y el stock se sincroniza en los dos sentidos. */}
      <p className="rounded-md border border-brand-vanilla-dark bg-brand-green-50 px-4 py-3 text-sm text-brand-ink/80 dark:border-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-vanilla/80">
        Los productos vienen de la tienda en línea (consentidovelas.com): se crean y se editan allá, en
        Productos. El stock se sincroniza solo — lo que vendas acá se descuenta allá y al revés.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : productos.length === 0 ? (
        <div className="rounded-lg border border-brand-vanilla-dark p-8 text-center dark:border-brand-green-700">
          <p className="text-brand-ink/60 dark:text-brand-vanilla/60">No hay productos registrados aún</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Categoría</th>
                <th className="px-4 py-2">Stock</th>
                <th className="px-4 py-2">Precio</th>
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr key={producto.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                  <td className="px-4 py-2 font-medium">
                    {producto.nombre}
                    {producto.ecommerce_publicado === false && (
                      <span className="ml-2 rounded bg-brand-vanilla-dark px-1.5 py-0.5 text-[10px] font-normal text-brand-ink/70 dark:bg-brand-green-700 dark:text-brand-vanilla/70">
                        No publicado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                    {producto.sku || "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                    {producto.categoria || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        producto.stock <= 0
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : producto.stock <= 5
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      }`}
                    >
                      {producto.stock}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{formatMoney(producto.precio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
