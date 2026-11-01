import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { reportesApi, type GastoFila, type GastoProveedorTotal, type GastosReporte } from "../api";

interface GastosTabProps {
  desde: string;
  hasta: string;
}

type MetodoFiltro = "" | "efectivo" | "banco";

/** "YYYY-MM-DD" → "15/10/2026" (es-CO). Mismo cuidado de construir el `Date`
 *  con año/mes/día explícitos que `VentasTab.tsx::formatFechaCorta` (evita el
 *  desplazamiento de un día del parseo UTC de `new Date(fecha)`). */
function formatFechaCorta(fecha: string): string {
  const [anioStr, mesStr, diaStr] = fecha.split("-");
  const d = new Date(Number(anioStr), Number(mesStr) - 1, Number(diaStr));
  return d.toLocaleDateString("es-CO");
}

/** `movimientos_caja.metodo_pago` solo admite 'efectivo'/'banco' (CHECK
 *  constraint, ver `GastoFila` en `reportes.types.ts`) — a diferencia de
 *  `VentasTab.tsx::etiquetaMetodoPago` (que también cubre 'mixto'/`null`),
 *  acá el tipo ya garantiza que solo llegan esos 2 valores. */
function etiquetaMetodoPago(metodo: "efectivo" | "banco"): string {
  return metodo === "efectivo" ? "Efectivo" : "Banco";
}

/**
 * Color único (una sola serie, un solo hue) para el gráfico de categoría de
 * abajo — a propósito NO una paleta categórica de varios colores: cada barra
 * del gráfico es una categoría distinta en el eje X (no una serie más que
 * compita por identidad de color contra otra), y el número de categorías es
 * variable (el Spec permite crear categorías de gasto nuevas desde el panel
 * de Caja), así que una paleta de cardinalidad fija no aplica acá — es un
 * caso de "magnitud por categoría" (un solo hue), no de "identidad entre
 * series". Reusa el verde de "Talleres" de `ResumenTab.tsx`/
 * `VentasPorTipoTab.tsx::COLOR_LINEA_NEGOCIO` (ya validado daltonismo/
 * contraste contra ambos fondos del tema) en vez de inventar un hex nuevo.
 */
const COLOR_CATEGORIA: Record<"light" | "dark", string> = {
  light: "#1baf7a",
  dark: "#199e70",
};

/**
 * Una fila de la tabla de detalle — columnas del Spec MENOS Cantidad/Costo
 * unitario: `GastoFila` (backend) nunca trae esos 2 campos, a propósito (ver
 * doc en `reportes.types.ts`: un egreso es un monto total con `motivo` en
 * texto libre, no una lista de ítems con cantidad/costo unitario — ese
 * desglose por línea no existe en el modelo actual). No se renderiza ninguna
 * columna vacía/placeholder para ellas: la tabla solo tiene las 6 columnas
 * que sí existen.
 */
function FilaGastoRow({ fila }: { fila: GastoFila }) {
  return (
    <tr className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
      <td className="whitespace-nowrap px-3 py-2">{formatFechaCorta(fila.fecha)}</td>
      <td className="whitespace-nowrap px-3 py-2">{fila.proveedor ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">{fila.categoria}</td>
      <td className="px-3 py-2">{fila.motivo ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(fila.monto)}</td>
      <td className="whitespace-nowrap px-3 py-2">{etiquetaMetodoPago(fila.metodo_pago)}</td>
    </tr>
  );
}

function TablaGastos({ filas }: { filas: GastoFila[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">Fecha</th>
            <th className="whitespace-nowrap px-3 py-2">Proveedor</th>
            <th className="whitespace-nowrap px-3 py-2">Categoría</th>
            <th className="px-3 py-2">Descripción</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Total</th>
            <th className="whitespace-nowrap px-3 py-2">Método</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                No hay gastos en este rango con los filtros actuales.
              </td>
            </tr>
          ) : (
            filas.map((fila) => <FilaGastoRow key={fila.id} fila={fila} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Totales al pie — SOLO general/bancos/efectivo. A diferencia de "Cuentas
 * por pagar" en `ResumenTab.tsx` (que sí se muestra como tarjeta "No
 * disponible" porque es un KPI del Spec sin dato real hoy), un total de
 * "préstamo" ni siquiera es una fila conceptual de este reporte: no existe
 * ese método de pago en el sistema (`movimientos_caja.metodo_pago` tiene un
 * CHECK que solo admite 'efectivo'/'banco', ver doc de `GastoFila` en
 * `reportes.types.ts`) — se omite del todo, nunca se renderiza en "$0" ni en
 * "No disponible" (ninguna de las dos formas sería honesta: "$0" sugiere que
 * sí existe la categoría y simplemente no se usó; "No disponible" sugiere
 * que el dato existe pero no se pudo traer).
 */
function TotalesFooter({ totales }: { totales: GastosReporte["totales"] }) {
  const filas: { etiqueta: string; valor: number }[] = [
    { etiqueta: "Total general", valor: totales.total_general },
    { etiqueta: "Total efectivo", valor: totales.total_efectivo },
    { etiqueta: "Total bancos", valor: totales.total_bancos },
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-green-700 dark:border-brand-vanilla">
      <table className="w-full text-left text-sm">
        <tbody>
          {filas.map((f, i) => (
            <tr
              key={f.etiqueta}
              className={`${i > 0 ? "border-t border-brand-vanilla-dark dark:border-brand-green-700" : ""} bg-brand-green-50 font-semibold dark:bg-brand-green-700/30`}
            >
              <td className="px-3 py-2 text-brand-green-700 dark:text-brand-vanilla">{f.etiqueta}</td>
              <td className="px-3 py-2 text-right text-brand-green-700 dark:text-brand-vanilla">
                {formatMoney(f.valor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaTopProveedores({ proveedores }: { proveedores: GastoProveedorTotal[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">#</th>
            <th className="px-3 py-2">Proveedor</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {proveedores.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                No hay proveedores con gastos en este rango.
              </td>
            </tr>
          ) : (
            proveedores.map((p, i) => (
              <tr key={p.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                <td className="whitespace-nowrap px-3 py-2 text-brand-ink/60 dark:text-brand-vanilla/60">{i + 1}</td>
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(p.total)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pestaña "Gastos" del módulo Reportes — endpoint `reportesApi.obtenerGastos`
 * (Task 5 backend/Task 10 frontend): detalle de egresos (filtrable),
 * ranking top-10 de proveedores y gastos por categoría (siempre sobre el
 * universo completo del rango, sin los 3 filtros opcionales — ver doc de
 * `reportes.service.ts::obtenerGastos`). Mismo patrón que
 * `ResumenTab.tsx`/`VentasTab.tsx`/`VentasPorTipoTab.tsx`: recibe
 * `desde`/`hasta` del `PeriodoSelector` de `ReportesPage` y hace su propia
 * llamada acá adentro, con el mismo guard `cancelado` contra respuestas
 * obsoletas.
 *
 * Filtros propios: categoría y método son `<select>` poblados con datos que
 * YA llegan en la respuesta (`gastosPorCategoria`/`topProveedores`, ambos
 * independientes de los 3 filtros opcionales por diseño del backend — no
 * encogen ni cambian al filtrar), sin pedir un endpoint propio.
 *
 * El filtro de "Proveedor" del brief lo pedía como texto libre, pero
 * `GastosFiltros.proveedorId` (schema del backend) es un match EXACTO contra
 * `proveedores.id` (UUID), no una búsqueda `LIKE` por nombre — un input de
 * texto libre mandando un nombre como si fuera el id nunca matchearía nada
 * (silenciosamente "no hay resultados", distinto del caso ya documentado de
 * "Cliente" en `VentasTab.tsx::FilaVentaRow` donde el filtro es inerte pero
 * no engañoso). Además, el catálogo completo de proveedores vive en
 * `GET /caja/proveedores`, gateado por `general.caja.ver` — un permiso
 * DISTINTO del `general.dashboard.analytics.ver` que gatea todo este módulo
 * (ver `caja.routes.ts`), así que llamarlo acá rompería este reporte para
 * cualquier usuario con acceso a Reportes pero sin acceso a Caja. Se
 * resuelve con un `<select>` poblado desde `topProveedores` (ya incluido en
 * esta misma respuesta, mismo permiso, match exacto por `id`): cubre el caso
 * de uso real (filtrar por uno de los proveedores que más gasta) sin el
 * riesgo de permisos ni el filtro roto — con la limitación documentada en el
 * footnote de abajo (un proveedor fuera del top 10 no es seleccionable,
 * aunque sus filas sí aparecen en la tabla de detalle sin filtrar).
 */
export function GastosTab({ desde, hasta }: GastosTabProps) {
  const { tema } = useTheme();
  const [categoriaId, setCategoriaId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [metodo, setMetodo] = useState<MetodoFiltro>("");
  const [datos, setDatos] = useState<GastosReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerGastos({
        desde,
        hasta,
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        proveedorId: proveedorId || undefined,
        metodo: metodo || undefined,
      })
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar los gastos");
      });
    return () => {
      cancelado = true;
    };
  }, [desde, hasta, categoriaId, proveedorId, metodo]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const { filas, topProveedores, gastosPorCategoria, totales } = datos;

  // Alfabético para el `<select>` (orden estable mientras se cambian otros
  // filtros) — distinto del orden usado para el gráfico de abajo (por total
  // descendente, igual criterio que `ResumenTab.tsx::gastosOrdenados`).
  const categoriasSelect = [...gastosPorCategoria].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const categoriasGrafico = [...gastosPorCategoria].sort((a, b) => b.total - a.total);

  return (
    <div className="flex flex-col gap-8">
      {/* Paso 1: filtros propios de esta pestaña (además del PeriodoSelector
       *  global) — los 3 son `<select>`, sin debounce (a diferencia de los
       *  inputs de texto de VentasTab.tsx, acá no hay texto libre). */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Categoría
          </span>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          >
            <option value="">Todas</option>
            {categoriasSelect.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Proveedor
          </span>
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          >
            <option value="">Todos</option>
            {topProveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Método de pago
          </span>
          <select
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoFiltro)}
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          >
            <option value="">Todos</option>
            <option value="efectivo">Efectivo</option>
            <option value="banco">Banco</option>
          </select>
        </label>
      </div>

      {/* Paso 2: tabla de detalle + totales al pie */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">Detalle de gastos</h3>
        <TablaGastos filas={filas} />
      </section>

      <TotalesFooter totales={totales} />

      {/* Paso 3: ranking top 10 de proveedores + gráfico por categoría */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Top 10 proveedores
        </h3>
        <TablaTopProveedores proveedores={topProveedores} />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold text-brand-green-700 dark:text-brand-vanilla">
          Gastos por categoría
        </h3>
        {categoriasGrafico.length === 0 ? (
          <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">
            No hay datos para graficar en este rango.
          </p>
        ) : (
          <div className="h-72 w-full rounded-lg border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoriasGrafico} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={tema === "dark" ? "#2c2c2a" : "#e1e0d9"}
                  vertical={false}
                />
                <XAxis dataKey="nombre" stroke={tema === "dark" ? "#c3c2b7" : "#52514e"} fontSize={12} />
                <YAxis
                  stroke={tema === "dark" ? "#c3c2b7" : "#52514e"}
                  fontSize={12}
                  width={80}
                  tickFormatter={(valor) => formatMoney(Number(valor))}
                />
                <Tooltip
                  formatter={(valor) => [formatMoney(Number(valor)), "Total"]}
                  contentStyle={{
                    backgroundColor: tema === "dark" ? "#1a1a19" : "#fcfcfb",
                    border: `1px solid ${tema === "dark" ? "#383835" : "#c3c2b7"}`,
                    color: tema === "dark" ? "#f0efec" : "#0b0b0b",
                  }}
                />
                <Bar dataKey="total" name="Total" fill={COLOR_CATEGORIA[tema]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Footnote de la limitación del filtro de "Proveedor" (ver doc del
       *  componente arriba) — mismo criterio textual que el de "Cliente" en
       *  VentasTab.tsx. */}
      <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
        * El filtro de "Proveedor" solo incluye los 10 proveedores con mayor gasto del rango (el mismo ranking de la
        tabla de arriba); un proveedor fuera del top 10 no es seleccionable ahí, aunque sus gastos sí se incluyen en
        la tabla de detalle y en los totales cuando no se aplica ningún filtro de proveedor.
      </p>
    </div>
  );
}
