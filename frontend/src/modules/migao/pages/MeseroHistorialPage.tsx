import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type OrdenHistorialResumen } from "../api";

const POLL_MS = 15000;

function formatearFechaHora(fechaIso: string | null) {
  if (!fechaIso) return "—";
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FILA_POR_ESTADO: Record<string, string> = {
  cerrada: "border-l-4 border-brand-green-600 bg-brand-green-50/40 dark:bg-brand-green-700/10",
  cancelada: "border-l-4 border-red-400 bg-red-50/40 dark:bg-red-950/10",
};

/** Historial propio del Mesero: solo las órdenes que él mismo creó, y solo
 *  después de que Caja las cerró (cobradas) o canceló — mientras siguen
 *  abiertas se ven en la lista normal de "Mesero", no acá. */
export function MeseroHistorialPage() {
  const [historial, setHistorial] = useState<OrdenHistorialResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No pone loading=true en cada llamada: el sondeo de fondo actualiza los
  // datos sin ocultar la pantalla — solo se ve "Cargando..." la primera vez.
  async function cargar() {
    try {
      setHistorial(await migaoApi.listarHistorialPropio());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar tu historial");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/mesero" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Mi historial</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Órdenes que creaste y que Caja ya cobró o canceló.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Mesa</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Fecha y hora</th>
              <th className="px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : historial.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-brand-ink/60">
                  Todavía no tienes órdenes cobradas ni canceladas.
                </td>
              </tr>
            ) : (
              historial.map((o) => (
                <tr
                  key={o.id}
                  className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                    FILA_POR_ESTADO[o.estado] ?? ""
                  }`}
                >
                  <td className="px-3 py-2">
                    {o.mesa_numero ?? "—"}
                    {o.mesa_piso && (
                      <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> (piso {o.mesa_piso})</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${
                        o.estado === "cerrada" ? "bg-brand-green-600 text-brand-vanilla" : "bg-red-400 text-white"
                      }`}
                    >
                      {o.estado === "cerrada" ? "Cobrada" : "Cancelada"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatearFechaHora(o.closed_at)}</td>
                  <td className="px-3 py-2">{formatMoney(o.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
