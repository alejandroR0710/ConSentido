import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { reportesApi, type ConciliacionFila, type ConciliacionReporte } from "../api";
import { BotonExportarExcel } from "./BotonExportarExcel";

interface ConciliacionTabProps {
  desde: string;
  hasta: string;
}

/** "YYYY-MM-DD" → "15/10/2026" (es-CO). Mismo cuidado de construir el `Date`
 *  con año/mes/día explícitos que `VentasTab.tsx`/`VentasPorTipoTab.tsx`
 *  (evita el desplazamiento de un día del parseo UTC de `new Date(fecha)`). */
function formatFechaCorta(fecha: string): string {
  const [anioStr, mesStr, diaStr] = fecha.split("-");
  const d = new Date(Number(anioStr), Number(mesStr) - 1, Number(diaStr));
  return d.toLocaleDateString("es-CO");
}

/** Columna "Diferencia" con 2 decimales (centavos) — a propósito NO usa
 *  `formatMoney` (que redondea a entero porque el resto del negocio opera en
 *  pesos enteros, ver doc ahí): el backend ya redondea `diferencia` a 2
 *  decimales antes de comparar (centavos de COP, ver
 *  `reportes.service.ts::obtenerConciliacion`), y una diferencia real de
 *  pocos centavos se vería como "$0" con `formatMoney` — justo ocultaría la
 *  señal que esta columna existe para mostrar. */
function formatDiferencia(valor: number): string {
  return valor.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Una fila de la tabla — columnas del brief (Fecha/Total por método/Total por
 * tipo/Diferencia). El resaltado en rojo usa DIRECTO el `tiene_diferencia`
 * que manda el backend (`diferencia !== 0` después de redondear a 2
 * decimales, ver doc de `ConciliacionFila` en `reportes.types.ts`) — este
 * componente nunca recalcula la comparación del lado del frontend, para no
 * arriesgar que ambos lados diverjan sobre qué cuenta como "distinto".
 */
function FilaConciliacion({ fila }: { fila: ConciliacionFila }) {
  return (
    <tr
      className={
        fila.tiene_diferencia
          ? "border-t border-brand-vanilla-dark bg-red-50 text-red-700 dark:border-brand-green-700 dark:bg-red-950/20 dark:text-red-400"
          : "border-t border-brand-vanilla-dark dark:border-brand-green-700"
      }
    >
      <td className="whitespace-nowrap px-3 py-2">{formatFechaCorta(fila.fecha)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.total_por_metodo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">{formatMoney(fila.total_por_tipo)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
        {formatDiferencia(fila.diferencia)}
        {fila.tiene_diferencia && (
          <span className="ml-1.5" aria-label="Diferencia detectada" title="Diferencia detectada">
            ⚠
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Pestaña "Conciliación" del módulo Reportes — endpoint
 * `reportesApi.obtenerConciliacion` (Task 8 backend/Task 10 frontend):
 * verificación cruzada día por día entre el total por método de pago y el
 * total por línea de negocio, ambos derivados de la MISMA fila de
 * `movimientos_caja` (ver doc de `ConciliacionReporte` en
 * `reportes.types.ts`). Por construcción `diferencia` debería dar siempre
 * `0` contra datos reales (Task 8 Review Focus) — esta pestaña no intenta
 * "investigar" un descuadre que estructuralmente no puede ocurrir, solo
 * resalta la fila si el backend alguna vez manda `tiene_diferencia: true`
 * (señal de un bug real en la consulta, nunca un dato esperado).
 *
 * Mismo patrón que `VentasPorTipoTab.tsx`/`ResumenTab.tsx`: SÍ usa el
 * `PeriodoSelector` compartido de `ReportesPage` (a diferencia de
 * "Cierre de caja"/"Préstamos", ver `PESTANAS_SIN_PERIODO_COMPARTIDO` ahí) —
 * recibe `desde`/`hasta` y hace su propia llamada acá adentro, con el mismo
 * guard `cancelado` contra respuestas obsoletas si el período cambia rápido
 * mientras una consulta anterior todavía está en vuelo.
 */
export function ConciliacionTab({ desde, hasta }: ConciliacionTabProps) {
  const [datos, setDatos] = useState<ConciliacionReporte | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    setDatos(null);
    reportesApi
      .obtenerConciliacion(desde, hasta)
      .then((res) => {
        if (!cancelado) setDatos(res);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar la conciliación");
      });
    return () => {
      cancelado = true;
    };
  }, [desde, hasta]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>;

  const { dias } = datos;
  const diasConDiferencia = dias.filter((d) => d.tiene_diferencia).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Task 18: exportar este mismo rango a Excel — esquina superior. */}
      <div className="flex justify-end">
        <BotonExportarExcel tipo="conciliacion" filtros={{ desde, hasta }} />
      </div>

      {/* Resumen de una línea: refuerza con texto lo que la tabla ya muestra
       *  con color, sin montar ninguna herramienta de "investigación" extra
       *  (brief: un simple resaltado de fila alcanza para un caso que no
       *  debería ocurrir nunca contra datos reales). */}
      {diasConDiferencia > 0 ? (
        <p className="text-sm font-medium text-red-700 dark:text-red-400">
          {diasConDiferencia} de {dias.length} día(s) con diferencia — revisar la consulta de conciliación.
        </p>
      ) : (
        dias.length > 0 && (
          <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
            Sin diferencias: los {dias.length} día(s) del rango cuadran entre método de pago y línea de negocio.
          </p>
        )
      )}

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Fecha</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Total por método</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Total por tipo</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {dias.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-brand-ink/60 dark:text-brand-vanilla/60">
                  No hay datos de conciliación en este rango.
                </td>
              </tr>
            ) : (
              dias.map((dia) => <FilaConciliacion key={dia.fecha} fila={dia} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
