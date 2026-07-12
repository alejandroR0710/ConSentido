import { useEffect, useState } from "react";
import { ApiError, resolveImageUrl } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { insumosApi, type Almacen, type Insumo } from "../api";
import { EditarInsumoModal } from "../components/EditarInsumoModal";
import { NuevoInsumoModal } from "../components/NuevoInsumoModal";
import { RegistrarMovimientoModal } from "../components/RegistrarMovimientoModal";

export function InsumosListPage() {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalAbierto, setModalAbierto] = useState<"nuevo" | "movimiento" | null>(null);
  const [insumoEditando, setInsumoEditando] = useState<Insumo | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const [listaInsumos, listaAlmacenes] = await Promise.all([
        insumosApi.listarAdmin(),
        insumosApi.listarAlmacenes(),
      ]);
      setInsumos(listaInsumos);
      setAlmacenes(listaAlmacenes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar Insumos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Insumos</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Catálogo de materias primas e inventario unificado que consumen los demás módulos.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setModalAbierto("movimiento")}
            className="rounded-md border-2 border-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
          >
            Registrar movimiento
          </button>
          <button
            onClick={() => setModalAbierto("nuevo")}
            className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
          >
            + Nuevo insumo
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Stock mínimo</th>
              <th className="px-3 py-2">Costo unitario</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : insumos.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-brand-ink/60">
                  Aún no hay insumos registrados.
                </td>
              </tr>
            ) : (
              insumos.map((i) => (
                <tr
                  key={i.id}
                  className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                    i.activo ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-3 py-2">
                    {resolveImageUrl(i.imagenUrl) ? (
                      <img
                        src={resolveImageUrl(i.imagenUrl)!}
                        alt=""
                        className="h-10 w-10 rounded-md border border-brand-vanilla-dark object-cover dark:border-brand-green-700"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md border border-dashed border-brand-vanilla-dark dark:border-brand-green-700" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {i.nombre}
                    {i.descripcion && (
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none text-xs text-brand-green-700 dark:text-brand-vanilla/80">
                          Descripción
                        </summary>
                        <p className="mt-1 max-w-xs text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                          {i.descripcion}
                        </p>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-2">{i.unidadMedida}</td>
                  <td className="px-3 py-2">{i.stockMinimo}</td>
                  <td className="px-3 py-2">{formatMoney(i.costoUnitario)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        i.activo
                          ? "rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                          : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300"
                      }
                    >
                      {i.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setInsumoEditando(i)}
                      className="rounded-md border border-brand-green-700 px-3 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto === "nuevo" && (
        <NuevoInsumoModal onCerrar={() => setModalAbierto(null)} onCreado={cargar} />
      )}

      {modalAbierto === "movimiento" && (
        <RegistrarMovimientoModal
          insumos={insumos.filter((i) => i.activo)}
          almacenes={almacenes}
          onCerrar={() => setModalAbierto(null)}
          onRegistrado={cargar}
        />
      )}

      {insumoEditando && (
        <EditarInsumoModal
          insumo={insumoEditando}
          onCerrar={() => setInsumoEditando(null)}
          onGuardado={cargar}
        />
      )}
    </div>
  );
}
