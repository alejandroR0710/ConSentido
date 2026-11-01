import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { reportesApi, type ResumenReporte } from "../api";
import { BotonExportarExcel } from "./BotonExportarExcel";

interface ResumenTabProps {
  desde: string;
  hasta: string;
}

/** Mismo componente visual que `TalleresAnalyticsSection.tsx`/
 *  `InsumosAnalyticsSection.tsx` para sus tarjetas de KPIs — no existe un
 *  `StatCard` compartido exportado hoy (brief Task 11), se replica el mismo
 *  marcado/clases Tailwind acá en vez de inventar un estilo nuevo.
 *  `valorClassName` opcional permite colorear el valor (mismo criterio que
 *  "saldo neto" en `TalleresAnalyticsSection.tsx::RangoBlock`: rojo si el
 *  valor quedó negativo) y también cubre el texto gris de "No disponible". */
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

/** Rojo si el valor quedó negativo, verde (color por defecto de la tarjeta)
 *  si no — mismo criterio que `TalleresAnalyticsSection.tsx::RangoBlock`
 *  aplica a su "saldo neto". */
function colorPorSigno(valor: number): string {
  return valor >= 0 ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600 dark:text-red-400";
}

// Las 3 líneas de negocio de `ingresosPorTipo`/`ventasPorMes` (Bloques D/E) —
// mismo universo de slugs acotado que usa el backend ahí (no las 5 del
// alcance de Bloques A/B/C). La fila sintética "total" de la matriz E se
// etiqueta acá también en vez de en el backend.
const ETIQUETA_LINEA_NEGOCIO: Record<string, string> = {
  insumos: "Insumos",
  con_sentido: "Con Sentido",
  talleres: "Talleres",
  total: "Total",
};

function etiquetaLinea(slug: string): string {
  return ETIQUETA_LINEA_NEGOCIO[slug] ?? slug;
}

// Paleta categórica validada (skill de dataviz del proyecto) para exactamente
// 3 series — pasa los chequeos de daltonismo/contraste en ambos temas. A
// propósito NO son los verdes de marca (todos el mismo tono): acá el color es
// el canal de identidad entre 3 líneas de negocio distintas, así que necesita
// separación real de matiz, no solo de intensidad.
const COLOR_LINEA_NEGOCIO: Record<"light" | "dark", Record<string, string>> = {
  light: { insumos: "#2a78d6", con_sentido: "#eb6834", talleres: "#1baf7a" },
  dark: { insumos: "#3987e5", con_sentido: "#d95926", talleres: "#199e70" },
};

/** "2026-10" → "Oct. 26" para encabezados de tabla/eje de gráfico compactos. */
function formatMesCorto(mes: string): string {
  const [anioStr, mesStr] = mes.split("-");
  const fecha = new Date(Number(anioStr), Number(mesStr) - 1, 1);
  const texto = fecha.toLocaleDateString("es", { month: "short", year: "2-digit" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Pestaña "Resumen" del módulo Reportes — Bloques A-E del endpoint
 * `reportesApi.obtenerResumen` (Task 2 backend/Task 10 frontend). Primera
 * pestaña real del módulo (Tasks 12-17 siguen el mismo patrón: recibir
 * `desde`/`hasta` del `PeriodoSelector` de `ReportesPage` y hacer su propia
 * llamada acá adentro, sin levantar el fetch al contenedor).
 */
export function ResumenTab({ desde, hasta }: ResumenTabProps) {
  const { tema } = useTheme();
  const [datos, setDatos] = useState<ResumenReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerResumen(desde, hasta)
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen");
      });
    return () => {
      cancelado = true;
    };
  }, [desde, hasta]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const { totales, flujoPorMetodoPago, gastosPorCategoria, ingresosPorTipo, ventasPorMes } = datos;

  // El brief pide ambas tablas (Bloques C/D) ordenadas descendente — el
  // backend ya las devuelve así (`ORDER BY total DESC` en Bloque C; Bloque D
  // sin orden garantizado), se ordena acá también para no depender de eso.
  const gastosOrdenados = [...gastosPorCategoria].sort((a, b) => b.total - a.total);
  const ingresosOrdenados = [...ingresosPorTipo].sort((a, b) => b.total - a.total);

  // Las 3 líneas de negocio reales de la matriz (sin la fila sintética
  // "total") — deciden qué `<Bar>` se dibuja y con qué color.
  const lineasNegocio = ventasPorMes.filas.map((f) => f.slug).filter((slug) => slug !== "total");

  // recharts espera un array "ancho" (un objeto por mes, una clave por serie),
  // no la matriz "larga" que manda el backend (una fila por línea de negocio
  // con un `valores` por mes) — pivote inverso al que ya hizo el backend para
  // la tabla.
  const datosGrafico = ventasPorMes.meses.map((mes) => {
    const fila: Record<string, number | string> = { mes: formatMesCorto(mes) };
    for (const slug of lineasNegocio) {
      const filaOrigen = ventasPorMes.filas.find((f) => f.slug === slug);
      fila[slug] = filaOrigen?.valores[mes] ?? 0;
    }
    return fila;
  });

  return (
    <div className="flex flex-col gap-8">
      {/* Task 18: exportar este mismo rango a Excel — esquina superior. */}
      <div className="flex justify-end">
        <BotonExportarExcel tipo="resumen" filtros={{ desde, hasta }} />
      </div>

      {/* Bloque A: KPIs generales del rango */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Resumen general</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard titulo="Ingresos totales" valor={formatMoney(totales.ingresos_total)} />
          <StatCard titulo="Gastos totales" valor={formatMoney(totales.gastos_total)} />
          <StatCard
            titulo="Utilidad"
            valor={formatMoney(totales.utilidad)}
            valorClassName={colorPorSigno(totales.utilidad)}
          />
          {/* `cuentas_por_pagar` es siempre `null` — dato no disponible en el
           *  sistema actual, nunca "$0" (confundiría "sin deuda" con "no se
           *  sabe"). Texto gris/muted, no el verde/rojo de las demás tarjetas. */}
          <StatCard
            titulo="Cuentas por pagar"
            valor="No disponible"
            detalle="No existe este dato en el sistema actual"
            valorClassName="text-brand-ink/40 dark:text-brand-vanilla/40"
          />
          <StatCard
            titulo="Utilidad real disponible"
            valor={formatMoney(totales.utilidad_real_disponible)}
            valorClassName={colorPorSigno(totales.utilidad_real_disponible)}
          />
        </div>
      </section>

      {/* Bloque B: flujo de caja por medio de pago */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Flujo por medio de pago
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard titulo="Ingresos efectivo" valor={formatMoney(flujoPorMetodoPago.ingresos_efectivo)} />
          <StatCard titulo="Ingresos banco" valor={formatMoney(flujoPorMetodoPago.ingresos_banco)} />
          <StatCard titulo="Gastos efectivo" valor={formatMoney(flujoPorMetodoPago.gastos_efectivo)} />
          <StatCard titulo="Gastos banco" valor={formatMoney(flujoPorMetodoPago.gastos_banco)} />
          <StatCard
            titulo="Disponible efectivo"
            valor={formatMoney(flujoPorMetodoPago.disponible_efectivo)}
            valorClassName={colorPorSigno(flujoPorMetodoPago.disponible_efectivo)}
          />
          <StatCard
            titulo="Disponible banco"
            valor={formatMoney(flujoPorMetodoPago.disponible_banco)}
            valorClassName={colorPorSigno(flujoPorMetodoPago.disponible_banco)}
          />
          <StatCard
            titulo="Total disponible"
            valor={formatMoney(flujoPorMetodoPago.total_disponible)}
            valorClassName={colorPorSigno(flujoPorMetodoPago.total_disponible)}
          />
        </div>
      </section>

      {/* Bloque C + D: dos tablas simples lado a lado (una columna en móvil) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
            Gastos por categoría
          </h3>
          <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {gastosOrdenados.map((g) => (
                  <tr key={g.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">{g.nombre}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Ingresos por tipo</h3>
          <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {ingresosOrdenados.map((i) => (
                  <tr key={i.slug} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">{etiquetaLinea(i.slug)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Bloque E: matriz de ventas por mes (histórico completo, no filtra
       *  por `desde`/`hasta`) + gráfico de barras agrupadas, una serie por
       *  línea de negocio. */}
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Ventas por mes</h3>

        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          {/* Sin `min-w` fijo a propósito: con 1-2 meses (caso común) debe
           *  caber sin scroll en móvil; con "Todo el histórico" (muchos
           *  meses) el ancho natural del contenido ya fuerza el scroll del
           *  `overflow-x-auto` de arriba — no hace falta un mínimo artificial. */}
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Línea de negocio</th>
                {ventasPorMes.meses.map((mes) => (
                  <th key={mes} className="px-3 py-2 text-right">
                    {formatMesCorto(mes)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ventasPorMes.filas.map((fila) => (
                <tr
                  key={fila.slug}
                  className={
                    fila.slug === "total"
                      ? "border-t-2 border-brand-green-700 bg-brand-green-50 font-semibold dark:border-brand-vanilla dark:bg-brand-green-700/30"
                      : "border-t border-brand-vanilla-dark dark:border-brand-green-700"
                  }
                >
                  <td className="px-3 py-2">{etiquetaLinea(fila.slug)}</td>
                  {ventasPorMes.meses.map((mes) => (
                    <td key={mes} className="px-3 py-2 text-right">
                      {formatMoney(fila.valores[mes] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="h-72 w-full rounded-lg border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datosGrafico} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tema === "dark" ? "#2c2c2a" : "#e1e0d9"} vertical={false} />
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
              {lineasNegocio.map((slug) => (
                <Bar
                  key={slug}
                  dataKey={slug}
                  name={slug}
                  fill={COLOR_LINEA_NEGOCIO[tema][slug] ?? "#898781"}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
