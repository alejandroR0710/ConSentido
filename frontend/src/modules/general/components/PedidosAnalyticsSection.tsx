import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { analyticsApi, type AnalyticsPedidos } from "../api";

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

function RangoBlock({ titulo, datos }: { titulo: string; datos: AnalyticsPedidos | null }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">{titulo}</h3>

      {!datos ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard titulo="Pedidos totales" valor={String(datos.pedidosTotal)} />
            <StatCard titulo="Ingresos" valor={formatMoney(datos.ingresoTotal)} />
            <StatCard titulo="Costos estimados" valor={formatMoney(datos.costoTotal)} />
            <StatCard
              titulo="Ganancia neta"
              valor={formatMoney(datos.gananciaTotal)}
              detalle={`${datos.margenPromedio}% margen promedio`}
            />
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">Estado de pedidos</h4>
            {datos.porEstado.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin pedidos en este rango.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {datos.porEstado.map((estado, i) => {
                  const estadoColor = {
                    pendiente: "bg-yellow-50 border-yellow-300 dark:bg-yellow-950/20 dark:border-yellow-700",
                    en_produccion: "bg-blue-50 border-blue-300 dark:bg-blue-950/20 dark:border-blue-700",
                    listo: "bg-green-50 border-green-300 dark:bg-green-950/20 dark:border-green-700",
                    entregado: "bg-brand-green-50 border-brand-green-300 dark:bg-brand-green-950/20 dark:border-brand-green-700",
                    cancelado: "bg-red-50 border-red-300 dark:bg-red-950/20 dark:border-red-700",
                  };
                  const bgClass = estadoColor[estado.estado as keyof typeof estadoColor] || "bg-gray-50 border-gray-300";

                  return (
                    <div key={i} className={`rounded-lg border-2 p-4 ${bgClass}`}>
                      <div className="font-medium capitalize text-brand-ink dark:text-brand-vanilla">{estado.estado.replace("_", " ")}</div>
                      <div className="mt-2 flex justify-between">
                        <span className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">{estado.cantidad} pedidos</span>
                        <span className="font-bold text-brand-green-700 dark:text-brand-vanilla">{formatMoney(estado.ingresoEstimado)}</span>
                      </div>
                    </div>
                  );
                })}
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

export function PedidosAnalyticsSection() {
  const [datosHoy, setDatosHoy] = useState<AnalyticsPedidos | null>(null);
  const [datosSemana, setDatosSemana] = useState<AnalyticsPedidos | null>(null);
  const [datosMes, setDatosMes] = useState<AnalyticsPedidos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<Rango>("semana");

  async function cargar() {
    setError(null);
    try {
      const rangoHoy = rangoFechas("hoy");
      const rangoSemana = rangoFechas("semana");
      const rangoMes = rangoFechas("mes");
      const [hoy, semana, mes] = await Promise.all([
        analyticsApi.obtenerPedidos(rangoHoy.desde, rangoHoy.hasta),
        analyticsApi.obtenerPedidos(rangoSemana.desde, rangoSemana.hasta),
        analyticsApi.obtenerPedidos(rangoMes.desde, rangoMes.hasta),
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

  const datosPorRango: Record<Rango, AnalyticsPedidos | null> = {
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
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Pedidos / Encargos</h2>

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
