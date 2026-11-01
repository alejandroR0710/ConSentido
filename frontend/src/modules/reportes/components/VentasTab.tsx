import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { reportesApi, type VentasFila, type VentasReporte } from "../api";

interface VentasTabProps {
  desde: string;
  hasta: string;
}

type MetodoFiltro = "" | "efectivo" | "banco";
type VistaTabla = "plana" | "agrupada";

/** "YYYY-MM-DD" → "15/10/2026" (es-CO). Construye el `Date` con
 *  año/mes/día explícitos en vez de `new Date(fecha)` (parseo UTC) — mismo
 *  cuidado que `ResumenTab.tsx::formatMesCorto` para no desplazar un día por
 *  el offset de huso horario del navegador. */
function formatFechaCorta(fecha: string): string {
  const [anioStr, mesStr, diaStr] = fecha.split("-");
  const d = new Date(Number(anioStr), Number(mesStr) - 1, Number(diaStr));
  return d.toLocaleDateString("es-CO");
}

/** Postgres/MySQL NUMERIC puede traer ceros de más ("1.500"); acá ya llega
 *  como `number` (el backend hace `Number(...)` antes de responder, ver
 *  `reportes.service.ts::obtenerVentas`), pero igual se pasa por
 *  `Number().toString()` — mismo truco que `migao/format.ts::formatCantidad`
 *  (no se importa cross-módulo, igual criterio que el resto de este módulo
 *  con sus tipos espejo) para no imprimir "1.500" en vez de "1.5". */
function formatCantidad(cantidad: number): string {
  return Number(cantidad).toString();
}

function etiquetaMetodoPago(metodo: "efectivo" | "banco" | "mixto" | null): string {
  if (metodo === "efectivo") return "Efectivo";
  if (metodo === "banco") return "Banco";
  if (metodo === "mixto") return "Mixto";
  // `null` solo es alcanzable en teoría (venta 'pendiente', ya excluida por
  // el backend — ver `reportes.service.ts::repartirPorMetodoPago`), defensivo.
  return "—";
}

/**
 * Una fila de la tabla. La columna "Cliente" del Spec se renderiza como "—"
 * para TODAS las filas a propósito: `VentasFila` (backend, `reportes.types.ts`)
 * no tiene ningún campo de cliente — ninguna de las dos fuentes
 * (`con_sentido_venta_items`/`movimientos_caja`) lo guarda (venta de
 * mostrador, ver nota en el documento de diseño: "Cliente casi siempre
 * vacío en mostrador, no es obligatorio en el sistema"). Es el mismo tipo de
 * brecha que `cuentas_por_pagar` en `ResumenTab.tsx` (dato no disponible,
 * nunca un valor inventado) — acá se resuelve con un footnote bajo la tabla
 * en vez de una tarjeta "No disponible" porque es una columna de una tabla
 * de filas, no un KPI suelto.
 *
 * Las filas `tipo === "sin_detalle"` (Paso 2 del backend: ingresos sin línea
 * de producto propia — abonos, ingresos manuales...) se distinguen
 * visualmente de una línea de producto real: fondo tenue + el texto de
 * `producto` (que en realidad es el `motivo` del movimiento) en cursiva con
 * una etiqueta "Sin detalle", y "Cantidad"/"Precio unitario" en "—" (son
 * `null` en el tipo, nunca se inventa un valor).
 */
function FilaVentaRow({ fila }: { fila: VentasFila }) {
  const esSinDetalle = fila.tipo === "sin_detalle";
  return (
    <tr
      className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
        esSinDetalle ? "bg-brand-vanilla/40 dark:bg-brand-green-700/10" : ""
      }`}
    >
      <td className="whitespace-nowrap px-3 py-2">{fila.consecutivo ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2">{formatFechaCorta(fila.fecha)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="px-3 py-2">
        {esSinDetalle ? (
          <span className="italic text-brand-ink/70 dark:text-brand-vanilla/70">
            {fila.producto ?? "Ingreso sin detalle"}
            <span className="ml-2 whitespace-nowrap rounded-full bg-brand-vanilla-dark/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-ink/60 dark:bg-brand-green-700/40 dark:text-brand-vanilla/60">
              Sin detalle
            </span>
          </span>
        ) : (
          fila.producto
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {fila.cantidad !== null ? formatCantidad(fila.cantidad) : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {fila.precio_unitario !== null ? formatMoney(fila.precio_unitario) : "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(fila.subtotal)}</td>
      <td className="whitespace-nowrap px-3 py-2">{etiquetaMetodoPago(fila.metodo_pago)}</td>
    </tr>
  );
}

/** Tabla de filas (columnas exactas del Spec) — reusada tanto por la vista
 *  plana (todas las filas) como por cada acordeón de la vista agrupada
 *  (filas de un solo día), sin duplicar el `<thead>`/estilos entre ambas. */
function TablaFilas({ filas }: { filas: VentasFila[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <tr>
            <th className="whitespace-nowrap px-3 py-2">Consecutivo</th>
            <th className="whitespace-nowrap px-3 py-2">Fecha</th>
            <th className="whitespace-nowrap px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Producto</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Cantidad</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Precio unitario</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Total</th>
            <th className="whitespace-nowrap px-3 py-2">Método de pago</th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                No hay ventas en este rango con los filtros actuales.
              </td>
            </tr>
          ) : (
            filas.map((fila) => <FilaVentaRow key={`${fila.tipo}-${fila.id}`} fila={fila} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Totales al pie (Spec: general/bancos/efectivo) — una tabla compacta de 2
 *  columnas, independiente de `TablaFilas`, para que se mantenga idéntica y
 *  totalmente legible en móvil (sin scroll) sea cual sea la vista (plana o
 *  agrupada) activa arriba — alinear columna por columna contra una tabla de
 *  8 columnas no aplica igual en la vista agrupada (ahí no hay una sola
 *  tabla "principal": hay un `<table>` por cada día). */
function TotalesFooter({ totales }: { totales: VentasReporte["totales"] }) {
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

/**
 * Pestaña "Ventas" del módulo Reportes — endpoint `reportesApi.obtenerVentas`
 * (Task 8 backend/Task 10 frontend). Mismo patrón que `ResumenTab.tsx`:
 * recibe `desde`/`hasta` del `PeriodoSelector` de `ReportesPage` y hace su
 * propia llamada acá adentro.
 *
 * Filtros propios (método/cliente/producto) además del período global —
 * `cliente` se manda igual al backend (acepta el filtro por compatibilidad
 * con el Spec) aunque hoy no tiene ningún efecto real en la query (ver nota
 * en `reportes.service.ts::obtenerVentas` y en `FilaVentaRow` arriba); se
 * deja el input de todas formas porque el Spec lo pide y una fuente futura
 * de datos de cliente sí lo activaría sin cambios en este componente.
 * Los 3 inputs de texto/select se debouncean 400ms antes de disparar el
 * fetch (evita una consulta por cada tecla) — mismo guard `cancelado` que
 * `ResumenTab.tsx` contra respuestas obsoletas si el período/filtro cambia
 * rápido mientras una consulta anterior todavía está en vuelo.
 */
export function VentasTab({ desde, hasta }: VentasTabProps) {
  const [metodo, setMetodo] = useState<MetodoFiltro>("");
  const [clienteInput, setClienteInput] = useState("");
  const [productoInput, setProductoInput] = useState("");
  const [cliente, setCliente] = useState("");
  const [producto, setProducto] = useState("");
  const [vista, setVista] = useState<VistaTabla>("plana");
  const [datos, setDatos] = useState<VentasReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setCliente(clienteInput.trim()), 400);
    return () => clearTimeout(t);
  }, [clienteInput]);

  useEffect(() => {
    const t = setTimeout(() => setProducto(productoInput.trim()), 400);
    return () => clearTimeout(t);
  }, [productoInput]);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerVentas({
        desde,
        hasta,
        metodo: metodo || undefined,
        cliente: cliente || undefined,
        producto: producto || undefined,
      })
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar las ventas");
      });
    return () => {
      cancelado = true;
    };
  }, [desde, hasta, metodo, cliente, producto]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const { filas, porDia, totales } = datos;

  // Agrupa `filas` por `fecha` para la vista agrupada — el orden de los
  // grupos viene de `porDia` (ya ordenado ascendente por el backend), no de
  // recorrer `filas` de nuevo.
  const filasPorFecha = new Map<string, VentasFila[]>();
  for (const fila of filas) {
    const grupo = filasPorFecha.get(fila.fecha) ?? [];
    grupo.push(fila);
    filasPorFecha.set(fila.fecha, grupo);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Filtros propios de esta pestaña (además del PeriodoSelector global) */}
      <div className="flex flex-wrap items-end gap-3">
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

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Cliente
          </span>
          <input
            type="text"
            value={clienteInput}
            onChange={(e) => setClienteInput(e.target.value)}
            placeholder="Buscar cliente..."
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink placeholder:text-brand-ink/40 dark:border-brand-green-700 dark:text-brand-vanilla dark:placeholder:text-brand-vanilla/40"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Producto
          </span>
          <input
            type="text"
            value={productoInput}
            onChange={(e) => setProductoInput(e.target.value)}
            placeholder="Buscar producto..."
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink placeholder:text-brand-ink/40 dark:border-brand-green-700 dark:text-brand-vanilla dark:placeholder:text-brand-vanilla/40"
          />
        </label>

        <div className="ml-auto flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
          {(["plana", "agrupada"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                vista === v
                  ? "bg-brand-green-600 text-white"
                  : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              }`}
            >
              {v === "plana" ? "Tabla plana" : "Agrupada por día"}
            </button>
          ))}
        </div>
      </div>

      {vista === "plana" ? (
        <TablaFilas filas={filas} />
      ) : porDia.length === 0 ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">
          No hay ventas en este rango con los filtros actuales.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {porDia.map((dia) => (
            <details
              key={dia.fecha}
              className="rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700"
            >
              <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
                <span>{formatFechaCorta(dia.fecha)}</span>
                <span>{formatMoney(dia.total)}</span>
              </summary>
              <div className="border-t border-brand-vanilla-dark p-3 dark:border-brand-green-700">
                <TablaFilas filas={filasPorFecha.get(dia.fecha) ?? []} />
              </div>
            </details>
          ))}
        </div>
      )}

      <TotalesFooter totales={totales} />

      {/* Footnote de la brecha de "Cliente" (ver doc de `FilaVentaRow`) —
       *  mismo criterio textual que el detalle de "Cuentas por pagar" en
       *  `ResumenTab.tsx`, pero como nota de columna en vez de tarjeta. */}
      <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
        * "Cliente" no está disponible: las ventas de mostrador no registran este dato en el sistema actual.
      </p>
    </div>
  );
}
