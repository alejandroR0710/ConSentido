import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { reportesApi, type VentasPorTipoDiaFila, type VentasPorTipoReporte } from "../api";
import { BotonExportarExcel } from "./BotonExportarExcel";

interface VentasPorTipoTabProps {
  desde: string;
  hasta: string;
}

// Las 3 líneas de negocio del reporte (mismo universo acotado que Bloque D/E
// de ResumenTab.tsx, sin la fila sintética "total" de ahí — este reporte ya
// trae `totales`/`participacion` como objetos aparte, no como una fila más).
const LINEAS_NEGOCIO = ["insumos", "con_sentido", "talleres"] as const;

const ETIQUETA_LINEA_NEGOCIO: Record<string, string> = {
  insumos: "Insumos",
  con_sentido: "Con Sentido",
  talleres: "Talleres",
};

function etiquetaLinea(slug: string): string {
  return ETIQUETA_LINEA_NEGOCIO[slug] ?? slug;
}

// Misma paleta categórica validada que ResumenTab.tsx::COLOR_LINEA_NEGOCIO —
// a propósito EXACTAMENTE los mismos 3 colores (no una paleta nueva): ambas
// pestañas representan las mismas 3 líneas de negocio, así que el color de
// "Insumos" acá debe ser el mismo azul que en el gráfico de Resumen (canal de
// identidad consistente entre pestañas, no solo dentro de una).
const COLOR_LINEA_NEGOCIO: Record<"light" | "dark", Record<string, string>> = {
  light: { insumos: "#2a78d6", con_sentido: "#eb6834", talleres: "#1baf7a" },
  dark: { insumos: "#3987e5", con_sentido: "#d95926", talleres: "#199e70" },
};

/** "YYYY-MM-DD" → "15/10/2026" (es-CO). Mismo cuidado de construir el `Date`
 *  con año/mes/día explícitos que `VentasTab.tsx::formatFechaCorta` (evita el
 *  desplazamiento de un día del parseo UTC de `new Date(fecha)`). */
function formatFechaCorta(fecha: string): string {
  const [anioStr, mesStr, diaStr] = fecha.split("-");
  const d = new Date(Number(anioStr), Number(mesStr) - 1, Number(diaStr));
  return d.toLocaleDateString("es-CO");
}

/** "2026-10" → "Oct. 26" — mismo formato que ResumenTab.tsx::formatMesCorto,
 *  para que el eje de este gráfico se lea igual que el de Bloque E. */
function formatMesCorto(mes: string): string {
  const [anioStr, mesStr] = mes.split("-");
  const fecha = new Date(Number(anioStr), Number(mesStr) - 1, 1);
  const texto = fecha.toLocaleDateString("es", { month: "short", year: "2-digit" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formatPercent(valor: number): string {
  return `${valor.toFixed(1)}%`;
}

type FilaMes = { mes: string } & Record<(typeof LINEAS_NEGOCIO)[number], number>;

/**
 * Agrupa `porDia` (el backend solo agrega por día, ver `reportes.types.ts`)
 * en un objeto por mes (`fecha.slice(0, 7)`) con las 3 líneas sumadas —
 * mismo pivote "ancho" que `ResumenTab.tsx::datosGrafico` necesita para
 * `recharts`, pero agregando acá en el frontend en vez de leer una matriz ya
 * agregada por mes del backend (ese Bloque E es histórico completo; este
 * reporte está acotado al rango seleccionado).
 */
function agruparPorMes(porDia: VentasPorTipoDiaFila[]): FilaMes[] {
  const porMes = new Map<string, Record<(typeof LINEAS_NEGOCIO)[number], number>>();
  for (const dia of porDia) {
    const mes = dia.fecha.slice(0, 7);
    const acumulado = porMes.get(mes) ?? { insumos: 0, con_sentido: 0, talleres: 0 };
    acumulado.insumos += dia.insumos;
    acumulado.con_sentido += dia.con_sentido;
    acumulado.talleres += dia.talleres;
    porMes.set(mes, acumulado);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valores]) => ({ mes: formatMesCorto(mes), ...valores }));
}

/**
 * Pestaña "Ventas por tipo" del módulo Reportes — endpoint
 * `reportesApi.obtenerVentasPorTipo` (Task 6 backend/Task 10 frontend):
 * pivot diario de las 3 líneas de negocio, mismo universo de filas que el
 * Bloque D del Resumen pero agrupado por día en vez de por el rango completo
 * (ver doc de `VentasPorTipoTotales` en `reportes.types.ts` — la suma de la
 * columna "Total" de la tabla diaria de abajo debe coincidir con
 * `totales.total` acá y con `ingresos_total`/Bloque D de `ResumenTab.tsx`
 * para el mismo rango).
 *
 * Mismo patrón que ResumenTab.tsx/VentasTab.tsx: recibe `desde`/`hasta` del
 * `PeriodoSelector` de `ReportesPage` y hace su propia llamada acá adentro,
 * con el mismo guard `cancelado` contra respuestas obsoletas si el período
 * cambia rápido mientras una consulta anterior todavía está en vuelo.
 */
export function VentasPorTipoTab({ desde, hasta }: VentasPorTipoTabProps) {
  const { tema } = useTheme();
  const [datos, setDatos] = useState<VentasPorTipoReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerVentasPorTipo(desde, hasta)
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar las ventas por tipo");
      });
    return () => {
      cancelado = true;
    };
  }, [desde, hasta]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const { porDia, totales, participacion } = datos;
  const datosGrafico = agruparPorMes(porDia);

  return (
    <div className="flex flex-col gap-8">
      {/* Task 18: exportar este mismo rango a Excel — esquina superior. */}
      <div className="flex justify-end">
        <BotonExportarExcel tipo="ventas-por-tipo" filtros={{ desde, hasta }} />
      </div>

      {/* Paso 1 + 2: tabla diaria (Fecha/Insumos/Con Sentido/Talleres/Total)
       *  con la fila de totales del rango al pie, dentro del mismo `<table>`
       *  — mismo criterio visual que la fila "total" de ResumenTab.tsx
       *  (borde superior doble + fondo + negrita) en vez de una tabla aparte. */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Ventas por línea de negocio
        </h3>
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Fecha</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Insumos</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Con Sentido</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Talleres</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {porDia.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                    No hay ventas en este rango.
                  </td>
                </tr>
              ) : (
                porDia.map((dia) => (
                  <tr key={dia.fecha} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="whitespace-nowrap px-3 py-2">{formatFechaCorta(dia.fecha)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(dia.insumos)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(dia.con_sentido)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(dia.talleres)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(dia.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {porDia.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-brand-green-700 bg-brand-green-50 font-semibold dark:border-brand-vanilla dark:bg-brand-green-700/30">
                  <td className="whitespace-nowrap px-3 py-2 text-brand-green-700 dark:text-brand-vanilla">Total</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                    {formatMoney(totales.insumos)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                    {formatMoney(totales.con_sentido)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                    {formatMoney(totales.talleres)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                    {formatMoney(totales.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Paso 2: % de participación de cada línea sobre `totales.total` del
       *  rango — una tarjeta por línea, con el mismo punto de color que el
       *  gráfico de abajo (y que el de ResumenTab.tsx) para que se identifique
       *  cada línea sin tener que leer la etiqueta. */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Participación sobre el total del rango
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {LINEAS_NEGOCIO.map((slug) => (
            <div
              key={slug}
              className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700"
            >
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: COLOR_LINEA_NEGOCIO[tema][slug] }}
                />
                {etiquetaLinea(slug)}
              </div>
              <div className="text-2xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatPercent(participacion[slug])}
              </div>
              <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                {formatMoney(totales[slug])}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Paso 3: gráfico de barras apiladas por mes — mismo `stackId` para
       *  las 3 series (Insumos/Con Sentido/Talleres apiladas en una sola
       *  barra por mes), a diferencia del gráfico agrupado (sin `stackId`)
       *  de Bloque E en ResumenTab.tsx: ahí interesa comparar líneas mes a
       *  mes lado a lado, acá interesa ver el total apilado por mes. Radio
       *  redondeado solo en la última serie declarada (Talleres, tope de la
       *  pila) — aplicarlo a las 3 deja huecos visuales en el medio de la
       *  barra apilada. */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Ventas por mes (apiladas)
        </h3>
        {datosGrafico.length === 0 ? (
          <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">
            No hay datos para graficar en este rango.
          </p>
        ) : (
          <div className="h-72 w-full rounded-lg border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={datosGrafico} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={tema === "dark" ? "#2c2c2a" : "#e1e0d9"}
                  vertical={false}
                />
                <XAxis dataKey="mes" stroke={tema === "dark" ? "#c3c2b7" : "#52514e"} fontSize={12} />
                <YAxis
                  stroke={tema === "dark" ? "#c3c2b7" : "#52514e"}
                  fontSize={12}
                  width={80}
                  tickFormatter={(valor) => formatMoney(Number(valor))}
                />
                <Tooltip
                  formatter={(valor, nombre) => [formatMoney(Number(valor)), etiquetaLinea(String(nombre))]}
                  contentStyle={{
                    backgroundColor: tema === "dark" ? "#1a1a19" : "#fcfcfb",
                    border: `1px solid ${tema === "dark" ? "#383835" : "#c3c2b7"}`,
                    color: tema === "dark" ? "#f0efec" : "#0b0b0b",
                  }}
                />
                <Legend formatter={(valor) => etiquetaLinea(String(valor))} />
                {LINEAS_NEGOCIO.map((slug, i) => (
                  <Bar
                    key={slug}
                    dataKey={slug}
                    name={slug}
                    stackId="lineas-negocio"
                    fill={COLOR_LINEA_NEGOCIO[tema][slug] ?? "#898781"}
                    radius={i === LINEAS_NEGOCIO.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
