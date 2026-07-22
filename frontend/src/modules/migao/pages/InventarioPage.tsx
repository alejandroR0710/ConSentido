import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type InventarioProducto } from "../api";
import { EditarInventarioProductoModal } from "../components/EditarInventarioProductoModal";
import { NuevoInventarioProductoModal } from "../components/NuevoInventarioProductoModal";
import { RegistrarMovimientoInventarioModal } from "../components/RegistrarMovimientoInventarioModal";

const POLL_MS = 15000;

function formatUnidades(valor: string) {
  const n = Number(valor);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Inventario de Migao: catálogo de insumos "tal como los entrega el
 *  proveedor" (paquetes de N unidades) + stock, que se descuenta solo cuando
 *  se vende un producto del menú con receta asociada — acá nunca se registra
 *  una salida a mano, solo entradas y ajustes de conteo. */
export function InventarioPage() {
  const [productos, setProductos] = useState<InventarioProducto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [productoEditando, setProductoEditando] = useState<InventarioProducto | null>(null);
  const [movimiento, setMovimiento] = useState<{ producto: InventarioProducto; tipo: "entrada" | "ajuste" } | null>(
    null,
  );

  async function cargar() {
    try {
      setProductos(await migaoApi.listarInventario());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el inventario");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  const productosFiltrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Inventario</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Insumos tal como los entrega el proveedor. El stock se descuenta solo al vender un producto del menú con
            receta asociada — acá solo se registran entradas y ajustes de conteo.
          </p>
        </div>
        <button
          onClick={() => setNuevoAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo producto
        </button>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar producto..."
        className="w-full max-w-sm rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : productos.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Aún no hay productos en el inventario.
        </p>
      ) : productosFiltrados.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          Sin resultados para "{busqueda}".
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Unid./paquete</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Costo paquete</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.map((p) => {
                const stock = Number(p.stock_unidades);
                const stockMinimo = p.stock_minimo_unidades !== null ? Number(p.stock_minimo_unidades) : null;
                const bajoStock = stock < 0 || (stockMinimo !== null && stock <= stockMinimo);
                const paquetesAprox = Math.floor(stock / Number(p.unidades_por_paquete));
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                      !p.activo ? "opacity-50" : bajoStock ? "bg-red-50 dark:bg-red-950/20" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      {p.nombre}
                      {p.tamano_unidad && (
                        <span className="ml-2 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                          ({p.tamano_unidad})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.unidad_medida}</td>
                    <td className="px-3 py-2">{formatUnidades(p.unidades_por_paquete)}</td>
                    <td className={`px-3 py-2 font-semibold ${bajoStock ? "text-red-600" : ""}`}>
                      {formatUnidades(p.stock_unidades)} {p.unidad_medida}
                      <div className="text-xs font-normal text-brand-ink/50 dark:text-brand-vanilla/50">
                        ~{paquetesAprox} paquete{paquetesAprox === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.costo_paquete ? `$${Number(p.costo_paquete).toLocaleString("es-CO")}` : "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.activo ? "bg-brand-green-50 text-brand-green-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {p.activo ? "activo" : "inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setMovimiento({ producto: p, tipo: "entrada" })}
                          className="rounded-md border border-brand-green-700 px-3 py-1 text-xs text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          + Entrada
                        </button>
                        <button
                          onClick={() => setMovimiento({ producto: p, tipo: "ajuste" })}
                          className="rounded-md border border-amber-500 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                        >
                          Ajuste
                        </button>
                        <button
                          onClick={() => setProductoEditando(p)}
                          aria-label="Editar producto"
                          className="rounded-md border border-brand-vanilla-dark px-3 py-1 text-xs dark:border-brand-green-700"
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nuevoAbierto && <NuevoInventarioProductoModal onCerrar={() => setNuevoAbierto(false)} onCreado={cargar} />}

      {productoEditando && (
        <EditarInventarioProductoModal
          producto={productoEditando}
          onCerrar={() => setProductoEditando(null)}
          onGuardado={cargar}
        />
      )}

      {movimiento && (
        <RegistrarMovimientoInventarioModal
          producto={movimiento.producto}
          tipo={movimiento.tipo}
          onCerrar={() => setMovimiento(null)}
          onRegistrado={cargar}
        />
      )}
    </div>
  );
}
