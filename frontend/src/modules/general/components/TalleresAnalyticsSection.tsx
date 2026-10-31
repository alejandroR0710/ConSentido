import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { analyticsApi, type AnalyticsTalleres } from "../api";

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

// Mismo componente visual que InsumosAnalyticsSection.tsx/GeneralAnalyticsSection.tsx
// — `valorClassName` opcional permite colorear el valor (ej. saldo neto en rojo
// si quedó negativo, mismo criterio que GeneralAnalyticsSection.tsx::RangoBlock).
function StatCard({
  titulo,
  valor,
  detalle,
  valorClassName,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  valorClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">{titulo}</div>
      <div className={`text-2xl font-bold ${valorClassName ?? "text-brand-green-700 dark:text-brand-vanilla"}`}>
        {valor}
      </div>
      {detalle && <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{detalle}</div>}
    </div>
  );
}

function RangoBlock({ titulo, datos }: { titulo: string; datos: AnalyticsTalleres | null }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">{titulo}</h3>

      {!datos ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard titulo="Ingresos" valor={formatMoney(datos.ingresos)} />
          <StatCard titulo="Egresos" valor={formatMoney(datos.egresos)} />
          <StatCard
            titulo="Saldo neto"
            valor={formatMoney(datos.saldoNeto)}
            detalle={datos.saldoNeto >= 0 ? "Ganancia del período" : "Pérdida del período"}
            valorClassName={
              datos.saldoNeto >= 0 ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600 dark:text-red-400"
            }
          />
        </div>
      )}
    </div>
  );
}

const RANGOS: { valor: Rango; etiqueta: string }[] = [
  { valor: "hoy", etiqueta: "Día" },
  { valor: "semana", etiqueta: "Semana" },
  { valor: "mes", etiqueta: "Mes" },
];

/**
 * Dashboard de Talleres — a diferencia de InsumosAnalyticsSection.tsx,
 * deliberadamente simple: no hay COGS/margen ni top de productos (Talleres
 * no tiene catálogo propio con costo), ni tabla de movimientos (fuera de
 * alcance de esta pasada) — solo ingresos/egresos/saldo neto del área, con
 * el mismo toggle Día/Semana/Mes y el mismo patrón de polling.
 */
export function TalleresAnalyticsSection() {
  const [datosHoy, setDatosHoy] = useState<AnalyticsTalleres | null>(null);
  const [datosSemana, setDatosSemana] = useState<AnalyticsTalleres | null>(null);
  const [datosMes, setDatosMes] = useState<AnalyticsTalleres | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<Rango>("semana");

  async function cargar() {
    setError(null);
    try {
      const rangoHoy = rangoFechas("hoy");
      const rangoSemana = rangoFechas("semana");
      const rangoMes = rangoFechas("mes");
      const [hoy, semana, mes] = await Promise.all([
        analyticsApi.obtenerTalleres(rangoHoy.desde, rangoHoy.hasta),
        analyticsApi.obtenerTalleres(rangoSemana.desde, rangoSemana.hasta),
        analyticsApi.obtenerTalleres(rangoMes.desde, rangoMes.hasta),
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

  const datosPorRango: Record<Rango, AnalyticsTalleres | null> = {
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
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Talleres</h2>

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
