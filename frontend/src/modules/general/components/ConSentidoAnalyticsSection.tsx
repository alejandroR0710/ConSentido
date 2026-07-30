import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { analyticsApi, type AnalyticsConSentido } from "../api";

type Rango = "hoy" | "semana" | "mes";
const POLL_MS = 15000;

function fechaISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function StatCard({ titulo, valor, detalle }: { titulo: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">{titulo}</div>
      <div className="text-2xl font-bold text-brand-green-700 dark:text-brand-vanilla">{valor}</div>
      {detalle && <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{detalle}</div>}
    </div>
  );
}

function RangoBlock({ titulo, datos }: { titulo: string; datos: AnalyticsConSentido | null }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">{titulo}</h3>

      {!datos ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard titulo="Ingresos totales" valor={formatMoney(datos.ingresos)} detalle={`${datos.ventasCount} ventas`} />
            <StatCard titulo="Ticket promedio" valor={formatMoney(datos.ingresos / (datos.ventasCount || 1))} />
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">Ventas por categoría</h4>
            {datos.ventasPorCategoria.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin ventas en este rango.</p>
            ) : (
              <div className="grid gap-3">
                {datos.ventasPorCategoria.map((cat) => (
                  <div key={cat.categoria} className="flex items-center justify-between rounded-lg bg-brand-green-50 p-3 dark:bg-brand-green-700/30">
                    <div>
                      <div className="font-medium text-brand-green-700 dark:text-brand-vanilla">{cat.categoria}</div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{cat.cantidad} unidades</div>
                    </div>
                    <div className="text-lg font-bold text-brand-green-700 dark:text-brand-vanilla">{formatMoney(cat.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">Productos más vendidos</h4>
            {datos.productosTopVendidos.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin productos en este rango.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2 text-right">Ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.productosTopVendidos.map((p, i) => (
                      <tr key={i} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                        <td className="px-3 py-2">{p.productoNombre}</td>
                        <td className="px-3 py-2 text-right">{p.cantidadVendida}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatMoney(p.ingresoTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">Clientes frecuentes</h4>
            {datos.clientesFrecuentes.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin clientes en este rango.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2 text-right">Compras</th>
                      <th className="px-3 py-2 text-right">Total gastado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.clientesFrecuentes.map((c, i) => (
                      <tr key={i} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                        <td className="px-3 py-2">{c.clienteNombre}</td>
                        <td className="px-3 py-2 text-right">{c.compras}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatMoney(c.totalGastado)}</td>
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

const RANGOS: { valor: Rango; etiqueta: string }[] = [
  { valor: "hoy", etiqueta: "Día" },
  { valor: "semana", etiqueta: "Semana" },
  { valor: "mes", etiqueta: "Mes" },
];

export function ConSentidoAnalyticsSection() {
  const [datosHoy, setDatosHoy] = useState<AnalyticsConSentido | null>(null);
  const [datosSemana, setDatosSemana] = useState<AnalyticsConSentido | null>(null);
  const [datosMes, setDatosMes] = useState<AnalyticsConSentido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<Rango>("semana");

  async function cargar() {
    setError(null);
    try {
      const rangoHoy = rangoFechas("hoy");
      const rangoSemana = rangoFechas("semana");
      const rangoMes = rangoFechas("mes");
      const [hoy, semana, mes] = await Promise.all([
        analyticsApi.obtenerConSentido(rangoHoy.desde, rangoHoy.hasta),
        analyticsApi.obtenerConSentido(rangoSemana.desde, rangoSemana.hasta),
        analyticsApi.obtenerConSentido(rangoMes.desde, rangoMes.hasta),
      ]);
      setDatosHoy(hoy);
      setDatosSemana(semana);
      setDatosMes(mes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las analíticas");
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  const datosPorRango: Record<Rango, AnalyticsConSentido | null> = {
    hoy: datosHoy,
    semana: datosSemana,
    mes: datosMes,
  };
  const tituloPorRango: Record<Rango, string> = {
    hoy: "Hoy",
    semana: "Esta semana",
    mes: "Este mes",
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Con Sentido</h2>

        <div className="flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
          {RANGOS.map((r) => (
            <button
              key={r.valor}
              onClick={() => setRango(r.valor)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                rango === r.valor
                  ? "bg-brand-green-600 text-white"
                  : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              }`}
            >
              {r.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <RangoBlock titulo={tituloPorRango[rango]} datos={datosPorRango[rango]} />
    </div>
  );
}
