import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { EditarMetodoPagoModal } from "../../../shared/components/EditarMetodoPagoModal";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type HistorialOrdenEntrada, type MetodoPago } from "../api";
import { DetalleCuentaMigao } from "../components/DetalleCuentaMigao";
import { ResetearOrdenesModal } from "../components/ResetearOrdenesModal";

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

/** Historial de Caja Migao: órdenes cobradas/canceladas + ingresos manuales
 *  registrados desde Caja con origen Migao. Antes vivía al final de la
 *  pantalla de cobro (Caja Migao); se separó a su propia pestaña. */
export function MigaoHistorialPage() {
  const { usuario } = useAuth();
  // Reiniciar historial de órdenes es exclusivo de Super Root; corregir el
  // método de pago de una cuenta ya cobrada es una capacidad más general que
  // "Root" también tiene.
  const esSuperRoot = usuario?.rol === "Super Root";
  const puedeEditarPagos = tieneAccesoTotal(usuario?.rol);

  const [historial, setHistorial] = useState<HistorialOrdenEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetAbierto, setResetAbierto] = useState(false);

  type MovimientoEditando =
    | {
        tipo: "ingreso_manual";
        movimientoId: number | string;
        metodoPagoActual: MetodoPago;
        monto: number;
        etiqueta: string;
      }
    | {
        tipo: "orden";
        movimientoId: number | string;
        metodoPagoActual: MetodoPago;
        monto: number;
        etiqueta: string;
        ordenId: string;
        mesaNumero: string | null;
        mesaPiso: number | null;
        meseroNombre: string | null;
        numeroPersonas: number | null;
        fecha: string | null;
      };
  const [movimientoEditando, setMovimientoEditando] = useState<MovimientoEditando | null>(null);

  const requestIdRef = useRef(0);

  async function cargarHistorial() {
    const requestId = ++requestIdRef.current;
    try {
      const historialData = await migaoApi.listarHistorialOrdenes();
      if (requestId !== requestIdRef.current) return;
      setHistorial(historialData);
      setError(null);
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    cargarHistorial();
    const intervalo = setInterval(cargarHistorial, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargarHistorial);

  // Vista exclusiva de Root/Super Root: el Cajero cobra desde "Caja Migao" pero
  // no tiene por qué auditar el historial ya cobrado/cancelado.
  if (!puedeEditarPagos) {
    return <Navigate to="/migao" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial Migao</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Órdenes cobradas/canceladas + ingresos manuales de Migao.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Mesa</th>
              <th className="px-3 py-2">Mesero</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">Fecha y hora</th>
              <th className="px-3 py-2">Total</th>
              {puedeEditarPagos && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={puedeEditarPagos ? 7 : 6} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : historial.length === 0 ? (
              <tr>
                <td colSpan={puedeEditarPagos ? 7 : 6} className="px-3 py-4 text-center text-brand-ink/60">
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
                        Ingreso manual
                      </span>
                    </td>
                    <td className="px-3 py-2">{h.metodo_pago}</td>
                    <td className="px-3 py-2">{formatearFechaHora(h.closed_at)}</td>
                    <td className="px-3 py-2">{formatMoney(h.monto)}</td>
                    {puedeEditarPagos && (
                      <td className="px-3 py-2">
                        <button
                          onClick={() =>
                            setMovimientoEditando({
                              tipo: "ingreso_manual",
                              movimientoId: h.id,
                              metodoPagoActual: h.metodo_pago as MetodoPago,
                              monto: Number(h.monto),
                              etiqueta: h.motivo ?? "Ingreso manual",
                            })
                          }
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                      </td>
                    )}
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
                    <td className="px-3 py-2">{h.metodo_pago ?? "—"}</td>
                    <td className="px-3 py-2">{formatearFechaHora(h.closed_at)}</td>
                    <td className="px-3 py-2">
                      {h.descuento_porcentaje > 0 ? (
                        <>
                          <div className="text-xs text-brand-ink/50 line-through dark:text-brand-vanilla/50">
                            {formatMoney(h.total)}
                          </div>
                          <div>
                            {formatMoney(h.total_cobrado)}{" "}
                            <span className="text-xs text-amber-700 dark:text-amber-400">
                              (-{h.descuento_porcentaje}%)
                            </span>
                          </div>
                        </>
                      ) : (
                        formatMoney(h.total)
                      )}
                    </td>
                    {puedeEditarPagos && (
                      <td className="px-3 py-2">
                        {h.estado === "cerrada" && h.movimiento_id != null && (
                          <button
                            onClick={() =>
                              setMovimientoEditando({
                                tipo: "orden",
                                movimientoId: h.movimiento_id!,
                                metodoPagoActual: h.metodo_pago!,
                                monto: Number(h.total_cobrado),
                                etiqueta: `Mesa ${h.mesa_numero ?? "—"}`,
                                ordenId: h.id,
                                mesaNumero: h.mesa_numero,
                                mesaPiso: h.mesa_piso,
                                meseroNombre: h.mesero_nombre,
                                numeroPersonas: h.numero_personas,
                                fecha: h.closed_at,
                              })
                            }
                            className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {esSuperRoot && (
        <div className="rounded-lg border-2 border-dashed border-red-300 p-4 dark:border-red-800">
          <h2 className="mb-1 font-medium text-red-600">Zona de Super Root</h2>
          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Borra por completo el historial de órdenes (no queda nada para consultar después).
          </p>
          <button
            onClick={() => setResetAbierto(true)}
            className="w-full max-w-xs rounded-md border-2 border-red-600 px-4 py-2 font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Reiniciar historial de órdenes
          </button>
        </div>
      )}

      {resetAbierto && (
        <ResetearOrdenesModal
          onCerrar={() => setResetAbierto(false)}
          onReseteado={async (mensajeReset) => {
            setMensaje(mensajeReset);
            await cargarHistorial();
          }}
        />
      )}

      {movimientoEditando && (
        <EditarMetodoPagoModal
          movimientoId={movimientoEditando.movimientoId}
          metodoPagoActual={movimientoEditando.metodoPagoActual}
          monto={movimientoEditando.monto}
          etiqueta={movimientoEditando.etiqueta}
          onCerrar={() => setMovimientoEditando(null)}
          onGuardado={cargarHistorial}
        >
          {movimientoEditando.tipo === "orden" && (
            <DetalleCuentaMigao
              ordenId={movimientoEditando.ordenId}
              mesaNumero={movimientoEditando.mesaNumero}
              mesaPiso={movimientoEditando.mesaPiso}
              meseroNombre={movimientoEditando.meseroNombre}
              numeroPersonas={movimientoEditando.numeroPersonas}
              fecha={movimientoEditando.fecha}
            />
          )}
        </EditarMetodoPagoModal>
      )}
    </div>
  );
}
