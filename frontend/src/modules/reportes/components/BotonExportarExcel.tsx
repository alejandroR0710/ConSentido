import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { reportesApi, type FiltrosExportarPorTipo, type TipoReporteExportar } from "../api";

interface BotonExportarExcelProps<T extends TipoReporteExportar> {
  tipo: T;
  filtros: FiltrosExportarPorTipo[T];
}

/**
 * Botón "Exportar a Excel" (Task 18) — una sola pieza reusada en las 7
 * pestañas del módulo (Tasks 11-17), cada una pasando su propio `tipo` +
 * los filtros/período que YA tiene activos (mismos valores que esa pestaña
 * usa para su propio `reportesApi.obtener*`, nunca un filtro inventado
 * aparte) para que el `.xlsx` descargado refleje exactamente lo que se ve
 * en pantalla.
 *
 * Patrón estándar de descarga de blob en el navegador: `reportesApi.exportar`
 * trae el binario (`apiFetchBlob`, ver `shared/api/client.ts`),
 * `URL.createObjectURL` lo convierte en una URL temporal, un `<a download>`
 * sintético (nunca insertado visualmente — se crea, se clickea y se
 * descarta en el mismo tick) dispara la descarga del navegador, y
 * `URL.revokeObjectURL` libera esa URL inmediatamente después del click
 * (sync: el navegador ya encoló la descarga en ese punto, no hace falta
 * esperar ningún evento para revocarla — mismo criterio que cualquier
 * ejemplo estándar de este patrón).
 *
 * El nombre del archivo descargado (`${tipo}.xlsx`) replica tal cual el
 * `Content-Disposition` que ya manda el backend para ese mismo `tipo` (ver
 * `reportes.controller.ts::exportarReporteController`) — no hace falta leer
 * el header de la respuesta para armarlo, `tipo` ya lo determina acá.
 */
export function BotonExportarExcel<T extends TipoReporteExportar>({ tipo, filtros }: BotonExportarExcelProps<T>) {
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setExportando(true);
    setError(null);
    try {
      const blob = await reportesApi.exportar(tipo, filtros);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `${tipo}.xlsx`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo exportar el reporte");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={exportando}
        className="rounded-md bg-brand-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {exportando ? "Exportando..." : "Exportar a Excel"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
