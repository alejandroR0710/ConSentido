import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { agruparPorOrden } from "../agruparTickets";
import { migaoApi, type ItemCocina } from "../api";
import { labelArea } from "../areas";
import { formatCantidad } from "../format";

const POLL_MS = 15000;

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Historial de "despachados": pedidos que Cocina ya dejó listos, sin importar
 *  si el mesero ya los marcó entregados. Solo consulta, no cambia nada — pero
 *  sí sondea en segundo plano para reflejar despachos nuevos sin recargar. */
export function CocinaHistorialPage() {
  const [items, setItems] = useState<ItemCocina[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No pone loading=true en cada llamada: el sondeo de fondo actualiza los
  // datos sin ocultar la pantalla — solo se ve "Cargando..." la primera vez.
  async function cargar() {
    try {
      setItems(await migaoApi.listarHistorialDespachados());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
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

  const tickets = useMemo(() => agruparPorOrden(items), [items]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/cocina" />
        <h1 className="text-2xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial de Cocina</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Pedidos ya despachados (listos o entregados). Últimos 300 productos.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-brand-ink/60">Cargando...</p>
      ) : tickets.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-lg text-brand-ink/60 dark:border-brand-green-700">
          Todavía no hay pedidos despachados.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tickets.map((ticket) => (
            <div
              key={ticket.ordenId}
              className="flex flex-col gap-2 rounded-xl border-2 border-brand-vanilla-dark bg-brand-vanilla p-4 opacity-90 dark:border-brand-green-700 dark:bg-brand-green-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                  Mesa {ticket.mesaNumero}
                  {ticket.mesaPiso && <span className="text-sm font-semibold"> ({labelArea(ticket.mesaPiso)})</span>}
                </span>
                <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                  {formatearFechaHora(ticket.items[0].created_at)}
                </span>
              </div>
              {ticket.meseroNombre && (
                <div className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">Mesero: {ticket.meseroNombre}</div>
              )}
              <ul className="flex flex-col gap-1">
                {ticket.items.map((item) => (
                  <li
                    key={item.id}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      item.estado === "servido"
                        ? "bg-brand-vanilla-dark/40 text-brand-ink/70 dark:bg-brand-green-700/20 dark:text-brand-vanilla/70"
                        : "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                    }`}
                  >
                    {formatCantidad(item.cantidad)}× {item.producto_nombre}
                    <span className="ml-2 text-xs opacity-70">({item.estado})</span>
                    {item.observaciones && (
                      <span className="block text-xs font-semibold text-amber-700 dark:text-amber-400">
                        ⚠ {item.observaciones}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
