import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import {
  migaoApi,
  type HistorialOrdenEntrada,
  type ItemActivo,
  type MetodoPago,
  type OrdenDetalle,
  type OrdenResumen,
} from "../api";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
import { EstadoBadge } from "../components/EstadoBadge";
import { ResetearOrdenesModal } from "../components/ResetearOrdenesModal";
import { BADGE_POR_ESTADO, ETIQUETA_POR_ESTADO, FILA_POR_ESTADO, estadoAgregadoOrden } from "../estadoOrden";
import { formatCantidad } from "../format";

const POLL_MS = 8000;

function formatearFechaHora(fechaIso: string | null) {
  if (!fechaIso) return "—";
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FILA_HISTORIAL_POR_ESTADO: Record<string, string> = {
  cerrada: "border-l-4 border-brand-green-600 bg-brand-green-50/40 dark:bg-brand-green-700/10",
  cancelada: "border-l-4 border-red-400 bg-red-50/40 dark:bg-red-950/10",
};

export function MigaoPage() {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";

  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [historial, setHistorial] = useState<HistorialOrdenEntrada[]>([]);
  const [itemsActivos, setItemsActivos] = useState<ItemActivo[]>([]);
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<OrdenDetalle | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("efectivo");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState<"cancelar" | "reset" | null>(null);

  // Ref (no state) para que el intervalo de polling, creado una sola vez al montar,
  // siempre lea cuál es la orden seleccionada actual sin necesidad de recrearse.
  const ordenSeleccionadaIdRef = useRef<string | null>(null);
  useEffect(() => {
    ordenSeleccionadaIdRef.current = ordenSeleccionadaId;
  }, [ordenSeleccionadaId]);

  async function cargarOrdenes() {
    try {
      setOrdenes(await migaoApi.listarOrdenesAbiertas());
      setItemsActivos(await migaoApi.listarItemsActivos());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las órdenes");
    } finally {
      setLoading(false);
    }

    const ordenSeleccionadaActual = ordenSeleccionadaIdRef.current;
    if (ordenSeleccionadaActual) {
      try {
        setDetalle(await migaoApi.obtenerDetalle(ordenSeleccionadaActual));
      } catch {
        // Si la orden ya no existe (se cerró/canceló desde otro dispositivo), el
        // detalle se deja como estaba; cerrarYCobrar/seleccionarOrden lo limpian.
      }
    }
  }

  async function cargarHistorial() {
    try {
      setHistorial(await migaoApi.listarHistorialOrdenes());
    } catch {
      /* la tabla de historial simplemente queda como estaba */
    }
  }

  useEffect(() => {
    cargarOrdenes();
    cargarHistorial();
    const intervalo = setInterval(cargarOrdenes, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  async function seleccionarOrden(ordenId: string) {
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
    setMensaje(null);
    setError(null);
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle de la orden");
    }
  }

  async function cerrarYCobrar() {
    if (!ordenSeleccionadaId) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await migaoApi.cerrarOrden(ordenSeleccionadaId, metodoPago);
      setMensaje(`Orden cobrada y cerrada. Total: ${formatMoney(resultado.total)}`);
      setDetalle(null);
      setOrdenSeleccionadaId(null);
      await cargarOrdenes();
      await cargarHistorial();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la orden");
    } finally {
      setCobrando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Migao (POS)</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cobro de mesas/órdenes. Cerrar o cancelar una orden es una acción exclusiva del rol Cajero.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[360px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Mesa</th>
                <th className="px-3 py-2">Mesero</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                    Cargando...
                  </td>
                </tr>
              ) : ordenes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                    No hay órdenes abiertas.
                  </td>
                </tr>
              ) : (
                ordenes.map((o) => {
                  const estadoCocina = estadoAgregadoOrden(o.id, itemsActivos);
                  return (
                    <tr
                      key={o.id}
                      onClick={() => seleccionarOrden(o.id)}
                      className={`cursor-pointer border-t border-brand-vanilla-dark hover:bg-brand-green-50 dark:border-brand-green-700 dark:hover:bg-brand-green-700/30 ${
                        estadoCocina ? FILA_POR_ESTADO[estadoCocina] : ""
                      } ${ordenSeleccionadaId === o.id ? "bg-brand-green-50 dark:bg-brand-green-700/30" : ""}`}
                    >
                      <td className="px-3 py-2">
                        {o.mesa_numero ?? "—"}
                        {o.mesa_piso && (
                          <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> (piso {o.mesa_piso})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{o.mesero_nombre ?? "—"}</td>
                      <td className="px-3 py-2">{o.cliente_nombre ?? "—"}</td>
                      <td className="px-3 py-2">
                        {estadoCocina ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${BADGE_POR_ESTADO[estadoCocina]}`}
                          >
                            {ETIQUETA_POR_ESTADO[estadoCocina]}
                          </span>
                        ) : (
                          o.estado
                        )}
                      </td>
                      <td className="px-3 py-2">{formatMoney(o.total)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
          <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">Detalle para cobro</h2>

          {!detalle ? (
            <p className="text-sm text-brand-ink/60">Selecciona una orden de la lista para ver su detalle.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-col gap-2">
                {detalle.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700"
                  >
                    <div>
                      <div className="text-base font-medium text-brand-ink dark:text-brand-vanilla">
                        {formatCantidad(item.cantidad)}× {item.producto_nombre}
                      </div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {formatMoney(item.precio_unitario)} c/u
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <EstadoBadge estado={item.estado} />
                      <span className="text-base font-semibold text-brand-ink dark:text-brand-vanilla">
                        {formatMoney(item.subtotal)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {detalle.items.some((i) => i.estado === "pendiente" || i.estado === "preparando") && (
                <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Todavía hay productos en cocina sin terminar.
                </p>
              )}

              <div className="mb-4 flex items-center justify-between border-t border-brand-vanilla-dark pt-3 text-base font-semibold dark:border-brand-green-700">
                <span>Total</span>
                <span>{formatMoney(detalle.total)}</span>
              </div>

              <label className="mb-1 block text-xs font-medium">Método de pago</label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              >
                <option value="efectivo">Efectivo</option>
                <option value="banco">Banco (tarjeta/transferencia)</option>
              </select>

              <button
                onClick={cerrarYCobrar}
                disabled={cobrando}
                className="mb-2 w-full rounded-md bg-brand-green-700 px-3 py-2 text-sm font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
              >
                {cobrando ? "Cobrando..." : "Cobrar y cerrar orden"}
              </button>

              <button
                onClick={() => setModalAbierto("cancelar")}
                disabled={cobrando}
                className="w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                Cancelar orden (cliente ya no quiere pedir)
              </button>
            </>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {mensaje && <p className="mt-3 text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">
          Historial (órdenes cobradas/canceladas + ingresos manuales de Migao)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Mesa</th>
                <th className="px-3 py-2">Mesero</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Fecha y hora</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                    Todavía no hay órdenes cobradas ni canceladas.
                  </td>
                </tr>
              ) : (
                historial.map((h) =>
                  h.tipo === "ingreso_manual" ? (
                    <tr
                      key={`ingreso-${h.id}`}
                      className="border-t border-l-4 border-brand-vanilla-dark border-l-brand-green-400 bg-brand-green-50/20 dark:border-brand-green-700 dark:bg-brand-green-700/10"
                    >
                      <td className="px-3 py-2 italic text-brand-ink/60 dark:text-brand-vanilla/60">
                        {h.motivo ?? "Sin mesa (ingreso manual)"}
                      </td>
                      <td className="px-3 py-2">{h.usuario_nombre ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-brand-green-400 px-2 py-0.5 text-xs font-bold whitespace-nowrap text-white">
                          Ingreso manual · {h.metodo_pago}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatearFechaHora(h.closed_at)}</td>
                      <td className="px-3 py-2">{formatMoney(h.monto)}</td>
                    </tr>
                  ) : (
                    <tr
                      key={h.id}
                      className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                        FILA_HISTORIAL_POR_ESTADO[h.estado] ?? ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        {h.mesa_numero ?? "—"}
                        {h.mesa_piso && (
                          <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> (piso {h.mesa_piso})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{h.mesero_nombre ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${
                            h.estado === "cerrada" ? "bg-brand-green-600 text-brand-vanilla" : "bg-red-400 text-white"
                          }`}
                        >
                          {h.estado === "cerrada" ? "Cobrada" : "Cancelada"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatearFechaHora(h.closed_at)}</td>
                      <td className="px-3 py-2">{formatMoney(h.total)}</td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {esSuperRoot && (
        <div className="rounded-lg border-2 border-dashed border-red-300 p-4 dark:border-red-800">
          <h2 className="mb-1 font-medium text-red-600">Zona de Super Root</h2>
          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Borra por completo el historial de órdenes (no queda nada para consultar después).
          </p>
          <button
            onClick={() => setModalAbierto("reset")}
            className="w-full max-w-xs rounded-md border-2 border-red-600 px-4 py-2 font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Reiniciar historial de órdenes
          </button>
        </div>
      )}

      {modalAbierto === "cancelar" && ordenSeleccionadaId && (
        <CancelarOrdenModal
          ordenId={ordenSeleccionadaId}
          onCerrar={() => setModalAbierto(null)}
          onCancelada={async (mensajeCancelacion) => {
            setMensaje(mensajeCancelacion);
            setDetalle(null);
            setOrdenSeleccionadaId(null);
            await cargarOrdenes();
            await cargarHistorial();
          }}
        />
      )}

      {modalAbierto === "reset" && (
        <ResetearOrdenesModal
          onCerrar={() => setModalAbierto(null)}
          onReseteado={async (mensajeReset) => {
            setMensaje(mensajeReset);
            setDetalle(null);
            setOrdenSeleccionadaId(null);
            await cargarOrdenes();
            await cargarHistorial();
          }}
        />
      )}
    </div>
  );
}
