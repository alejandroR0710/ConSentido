import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { analyticsApi, type AnalyticsMigao } from "../api";

type Rango = "hoy" | "semana" | "mes";

const POLL_MS = 15000;

function fechaISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lunes como inicio de semana, igual que en Historial de Caja. */
function inicioDeSemana(fecha: Date) {
  const d = new Date(fecha);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function rangoFechas(rango: Rango): { desde: string; hasta: string } {
  const hoy = new Date();
  const hasta = fechaISO(hoy);
  if (rango === "hoy") return { desde: hasta, hasta };
  if (rango === "semana") return { desde: fechaISO(inicioDeSemana(hoy)), hasta };
  return { desde: fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta };
}

function formatMin(min: number | null) {
  if (min === null) return "—";
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

function StatCard({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">{titulo}</div>
      <div className="text-2xl font-bold text-brand-green-700 dark:text-brand-vanilla">{valor}</div>
      {detalle && <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{detalle}</div>}
    </div>
  );
}

/** Analíticas de Migao (módulo priorizado): pedidos, ganancias, desempeño por
 *  mesero y tiempos de Cocina/entrega. Los tiempos de Cocina y de entrega solo
 *  tienen datos desde que se agregó el registro de esas transiciones — pedidos
 *  anteriores a eso no aparecen ahí, aunque sí cuentan en pedidos/ganancias. */
export function MigaoAnalyticsSection() {
  const [rango, setRango] = useState<Rango>("hoy");
  const [datos, setDatos] = useState<AnalyticsMigao | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);
    const { desde, hasta } = rangoFechas(rango);
    try {
      setDatos(await analyticsApi.obtenerMigao(desde, hasta));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las analíticas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Migao</h2>
        <div className="flex gap-1 rounded-md border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
          {(["hoy", "semana", "mes"] as Rango[]).map((r) => (
            <button
              key={r}
              onClick={() => setRango(r)}
              className={`rounded px-3 py-1 text-sm capitalize ${
                rango === r
                  ? "bg-brand-green-700 text-brand-vanilla"
                  : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading || !datos ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              titulo="Pedidos cobrados"
              valor={String(datos.pedidos.cerradas)}
              detalle={`${datos.pedidos.canceladas} cancelado(s)`}
            />
            <StatCard
              titulo="Comensales atendidos"
              valor={String(datos.pedidos.comensales)}
              detalle={
                datos.pedidos.clientesUnicos > 0 ? `${datos.pedidos.clientesUnicos} cliente(s) registrado(s)` : undefined
              }
            />
            <StatCard
              titulo="Ganancia"
              valor={formatMoney(datos.ganancias.ganancia)}
              detalle={`${formatMoney(datos.ganancias.ingresos)} ingresos − ${formatMoney(datos.ganancias.costos)} costo`}
            />
            <StatCard titulo="Ingresos en efectivo" valor={formatMoney(datos.ganancias.efectivo)} />
            <StatCard titulo="Ingresos en banco" valor={formatMoney(datos.ganancias.banco)} />
            <StatCard
              titulo="Total cobrado (Migao)"
              valor={formatMoney(datos.ganancias.ingresos)}
              detalle={`${formatMoney(datos.ganancias.efectivo)} efectivo + ${formatMoney(datos.ganancias.banco)} banco`}
            />
            <StatCard
              titulo="Productos vendidos"
              valor={String(datos.ganancias.itemsVendidos)}
            />
            <StatCard
              titulo="Tiempo de preparación (Cocina)"
              valor={formatMin(datos.cocina.tiempoPromedioMin)}
              detalle={`sobre ${datos.cocina.itemsPreparados} producto(s)`}
            />
            <StatCard
              titulo="Tiempo estimado de entrega"
              valor={formatMin(datos.entrega.tiempoPromedioMin)}
              detalle={`sobre ${datos.entrega.itemsEntregados} producto(s) entregado(s)`}
            />
          </div>

          <Link
            to="/migao/historial-administrativo"
            className="flex items-center justify-between rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
          >
            <div>
              <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Pago administrativo (no cuenta en Caja General)
              </div>
              <div className="text-xs text-amber-700/80 dark:text-amber-400/80">
                {datos.administrativo.cuentas} cuenta(s) en este rango — ver historial completo
              </div>
            </div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">
              {formatMoney(datos.administrativo.total)}
            </div>
          </Link>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Desempeño por mesero
            </h3>
            {datos.meseros.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin órdenes cobradas en este rango.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2">Mesero</th>
                      <th className="px-3 py-2">Órdenes</th>
                      <th className="px-3 py-2">Cancelados</th>
                      <th className="px-3 py-2">Total vendido</th>
                      <th className="px-3 py-2">Tiempo promedio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.meseros.map((m) => (
                      <tr key={m.meseroId} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                        <td className="px-3 py-2">{m.meseroNombre}</td>
                        <td className="px-3 py-2">{m.ordenes}</td>
                        <td className="px-3 py-2">{m.canceladas}</td>
                        <td className="px-3 py-2">{formatMoney(m.totalVendido)}</td>
                        <td className="px-3 py-2">{formatMin(m.tiempoPromedioMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
