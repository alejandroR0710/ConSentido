import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { reportesApi, type CierreCajaFila, type CierreCajaReporte } from "../api";
import { BotonExportarExcel } from "./BotonExportarExcel";

/** "YYYY-MM" del mes calendario en curso — valor inicial del selector propio
 *  de esta pestaña. Mismo cuidado de construir la fecha con año/mes
 *  explícitos que `PeriodoSelector.tsx::fechaISO` (acá solo hasta el mes, sin
 *  día). */
function mesActual(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → "15/10/2026" (es-CO). Mismo cuidado de construir el `Date`
 *  con año/mes/día explícitos que `VentasTab.tsx::formatFechaCorta`/
 *  `GastosTab.tsx::formatFechaCorta` (evita el desplazamiento de un día del
 *  parseo UTC de `new Date(fecha)`) — no se reusa cross-archivo porque
 *  ninguna de esas dos vive en un módulo compartido, mismo criterio que el
 *  resto de este módulo con sus duplicados locales. */
function formatFechaCorta(fecha: string): string {
  const [anioStr, mesStr, diaStr] = fecha.split("-");
  const d = new Date(Number(anioStr), Number(mesStr) - 1, Number(diaStr));
  return d.toLocaleDateString("es-CO");
}

/**
 * Una fila de la tabla diaria (o la fila `TOTAL`) — mismo componente para
 * ambas, sin lógica de suma/semántica especial acá: el backend ya resuelve
 * que la fila `TOTAL` tenga `venta_dia`/`venta_efectivo`/`venta_banco`/
 * `gastos_efectivo`/`gastos_banco` como SUMA de los días, pero
 * `efectivo`/`banco`/`total_dinero` como el saldo corrido del ÚLTIMO día (ver
 * doc de `CierreCajaReporte.total` en `reportes.types.ts`) — este componente
 * solo imprime los 9 campos de `CierreCajaFila` tal cual llegan, nunca los
 * recalcula ni los re-suma, así que esa diferencia de semántica por columna
 * queda resuelta enteramente del lado del backend (Review Focus del brief).
 */
function FilaCierreCaja({ fila, esTotal }: { fila: CierreCajaFila; esTotal: boolean }) {
  return (
    <tr
      className={
        esTotal
          ? "border-t-2 border-brand-green-700 bg-brand-green-50 font-semibold dark:border-brand-vanilla dark:bg-brand-green-700/30"
          : "border-t border-brand-vanilla-dark dark:border-brand-green-700"
      }
    >
      <td className="whitespace-nowrap px-3 py-2">
        {/* La fila `TOTAL` trae `fecha: "TOTAL"` literal (ver tipo) — se
         *  imprime tal cual, sin pasar por `formatFechaCorta` (que esperaría
         *  un `YYYY-MM-DD` real y fallaría con este literal). */}
        {esTotal ? "TOTAL" : formatFechaCorta(fila.fecha)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.venta_dia)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.venta_efectivo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.venta_banco)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.gastos_efectivo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.gastos_banco)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.efectivo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.banco)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(fila.total_dinero)}</td>
      <td className="px-3 py-2">{fila.notas_responsable}</td>
    </tr>
  );
}

/**
 * Fila de saldo inicial — arranca el saldo corrido del día 1 (ver doc de
 * `CierreCajaReporte.saldo_inicial` en `reportes.types.ts`). Columnas de
 * movimiento (venta/gastos) en "—": un saldo inicial no es un movimiento del
 * mes, no tiene sentido mostrar "$0" ahí (sería un dato inventado, no un
 * movimiento real de 0).
 *
 * `null` (ningún turno registrado hasta este mes) se renderiza como "Dato no
 * disponible" en una sola celda fusionada — NUNCA como "$0" (mismo criterio
 * que `cuentas_por_pagar` en `ResumenTab.tsx`: "$0" sugeriría "sabemos que la
 * caja abrió vacía", un dato distinto de "no sabemos con cuánto abrió").
 */
function FilaSaldoInicial({ saldoInicial }: { saldoInicial: CierreCajaReporte["saldo_inicial"] }) {
  if (saldoInicial === null) {
    return (
      <tr className="border-t border-brand-vanilla-dark bg-brand-vanilla/40 italic dark:border-brand-green-700 dark:bg-brand-green-700/10">
        <td className="whitespace-nowrap px-3 py-2 font-medium not-italic">Saldo inicial</td>
        <td colSpan={9} className="px-3 py-2 text-center text-brand-ink/40 dark:text-brand-vanilla/40">
          Dato no disponible
        </td>
      </tr>
    );
  }

  const totalDinero = saldoInicial.efectivo + saldoInicial.banco;
  return (
    <tr className="border-t border-brand-vanilla-dark bg-brand-vanilla/40 dark:border-brand-green-700 dark:bg-brand-green-700/10">
      <td className="whitespace-nowrap px-3 py-2 font-medium">Saldo inicial</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(saldoInicial.efectivo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(saldoInicial.banco)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{formatMoney(totalDinero)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-brand-ink/40 dark:text-brand-vanilla/40">—</td>
    </tr>
  );
}

/**
 * Pestaña "Cierre de caja" del módulo Reportes — endpoint
 * `reportesApi.obtenerCierreCaja` (Task 7 backend/Task 10 frontend).
 *
 * ÚNICA pestaña del módulo que NO usa el `PeriodoSelector` compartido de
 * `ReportesPage` (brief Task 15): ese selector solo resuelve `desde`/`hasta`,
 * pero este endpoint filtra por `mes` (`YYYY-MM`, ver
 * `reportes.schema.ts::reportesCierreCajaSchema` en el backend) — un rango de
 * fechas arbitrario no mapea 1:1 a "un mes calendario completo". Por eso este
 * componente no recibe ningún prop de período: administra su propio
 * `<input type="month">` y hace su propia llamada acá adentro, con el mismo
 * guard `cancelado` contra respuestas obsoletas que el resto de las pestañas.
 * `ReportesPage` oculta el `PeriodoSelector` compartido mientras esta pestaña
 * está activa (ver comentario ahí) para no mostrar un control que no tendría
 * ningún efecto sobre lo que se ve acá.
 */
export function CierreCajaTab() {
  const [mes, setMes] = useState(mesActual());
  const [datos, setDatos] = useState<CierreCajaReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerCierreCaja(mes)
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar el cierre de caja");
      });
    return () => {
      cancelado = true;
    };
  }, [mes]);

  return (
    <div className="flex flex-col gap-6">
      {/* Task 18: exportar el mes seleccionado a Excel — esquina superior. */}
      <div className="flex justify-end">
        <BotonExportarExcel tipo="cierre-caja" filtros={{ mes }} />
      </div>

      {/* Paso 1: selector de mes propio, independiente del PeriodoSelector
       *  global (ver doc del componente arriba). */}
      <label className="flex w-fit flex-col gap-1 text-sm">
        <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">Mes</span>
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !datos && (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      )}

      {datos && (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Fecha</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Venta día</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Venta efectivo</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Venta banco</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Gastos efectivo</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Gastos banco</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Efectivo</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Banco</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Total dinero</th>
                <th className="px-3 py-2">Notas / Responsable</th>
              </tr>
            </thead>
            <tbody>
              <FilaSaldoInicial saldoInicial={datos.saldo_inicial} />
              {datos.dias.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                    No hay días para mostrar en este mes.
                  </td>
                </tr>
              ) : (
                datos.dias.map((fila) => <FilaCierreCaja key={fila.fecha} fila={fila} esTotal={false} />)
              )}
              <FilaCierreCaja key="total" fila={datos.total} esTotal />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
