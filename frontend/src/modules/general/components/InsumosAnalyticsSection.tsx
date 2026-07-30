import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { analyticsApi, type AnalyticsInsumos } from "../api";

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

function RangoBlock({ titulo, datos }: { titulo: string; datos: AnalyticsInsumos | null }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">{titulo}</h3>

      {!datos ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard titulo="Ingresos" valor={formatMoney(datos.ingresos)} />
            <StatCard titulo="Costos" valor={formatMoney(datos.costos)} />
            <StatCard
              titulo="Ganancia neta"
              valor={formatMoney(datos.ganancia)}
              detalle={`${datos.margenNeto}% margen`}
            />
            <StatCard titulo="Ventas" valor={String(datos.ventasCount)} detalle="transacciones" />
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Análisis de productos
            </h4>
            {datos.productosVendidos.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin productos vendidos en este rango.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2 text-right">Costo unit.</th>
                      <th className="px-3 py-2 text-right">Precio unit.</th>
                      <th className="px-3 py-2 text-right">Margen unit.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.productosVendidos.map((p, i) => (
                      <tr key={i} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                        <td className="px-3 py-2">{p.productoNombre}</td>
                        <td className="px-3 py-2 text-right">{p.cantidadVendida}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(p.costo)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatMoney(p.precio)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${p.margen > 0 ? "text-brand-green-600 dark:text-brand-vanilla" : "text-red-600"}`}>
                          {formatMoney(p.margen)}
                        </td>
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

export function InsumosAnalyticsSection() {
  const [datosHoy, setDatosHoy] = useState<AnalyticsInsumos | null>(null);
  const [datosSemana, setDatosSemana] = useState<AnalyticsInsumos | null>(null);
  const [datosMes, setDatosMes] = useState<AnalyticsInsumos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<Rango>("semana");

  async function cargar() {
    setError(null);
    try {
      const rangoHoy = rangoFechas("hoy");
      const rangoSemana = rangoFechas("semana");
      const rangoMes = rangoFechas("mes");
      const [hoy, semana, mes] = await Promise.all([
        analyticsApi.obtenerInsumos(rangoHoy.desde, rangoHoy.hasta),
        analyticsApi.obtenerInsumos(rangoSemana.desde, rangoSemana.hasta),
        analyticsApi.obtenerInsumos(rangoMes.desde, rangoMes.hasta),
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

  const datosPorRango: Record<Rango, AnalyticsInsumos | null> = {
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
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Insumos</h2>

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
