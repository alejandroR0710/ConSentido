import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { EditarMetodoPagoModal } from "../../../shared/components/EditarMetodoPagoModal";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import {
  migaoApi,
  type HistorialOrdenEntrada,
  type ItemActivo,
  type MetodoPago,
  type OrdenDetalle,
  type OrdenResumen,
  type PagoInput,
} from "../api";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
import { DetalleCuentaMigao } from "../components/DetalleCuentaMigao";
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
  // Reiniciar historial de órdenes es exclusivo de Super Root; corregir el
  // método de pago de una cuenta ya cobrada es una capacidad más general que
  // "Root" también tiene.
  const esSuperRoot = usuario?.rol === "Super Root";
  const puedeEditarPagos = tieneAccesoTotal(usuario?.rol);

  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [historial, setHistorial] = useState<HistorialOrdenEntrada[]>([]);
  const [itemsActivos, setItemsActivos] = useState<ItemActivo[]>([]);
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<OrdenDetalle | null>(null);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [dividirCuenta, setDividirCuenta] = useState(false);
  const [numPartes, setNumPartes] = useState(2);
  // itemId (de orden_items) -> índice de parte (0-based) a la que quedó asignado.
  // Clave por UNIDAD de producto (no por ítem): un ítem con cantidad 2 genera
  // dos claves asignables por separado, para poder repartir "2x Americano"
  // entre dos personas en vez de mandarlo entero a una sola.
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});
  const [pagosPartes, setPagosPartes] = useState<MetodoPagoValor[]>([
    { metodoPago: "efectivo" },
    { metodoPago: "efectivo" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState<"cancelar" | "reset" | null>(null);
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

  // Ref (no state) para que el intervalo de polling, creado una sola vez al montar,
  // siempre lea cuál es la orden seleccionada actual sin necesidad de recrearse.
  const ordenSeleccionadaIdRef = useRef<string | null>(null);
  useEffect(() => {
    ordenSeleccionadaIdRef.current = ordenSeleccionadaId;
  }, [ordenSeleccionadaId]);

  // "Última petición gana": si el sondeo automático (cada 8s) ya había salido
  // justo antes de cobrar una orden, su respuesta puede llegar DESPUÉS del
  // refresco explícito que se dispara al cobrar y pisarlo con datos viejos —
  // la orden recién cerrada seguía viéndose unos segundos más. Con un id que
  // se incrementa en cada llamada, se descarta cualquier respuesta que ya no
  // sea la más reciente, sin importar el orden en que lleguen.
  const ordenesRequestIdRef = useRef(0);
  const historialRequestIdRef = useRef(0);

  async function cargarOrdenes() {
    const requestId = ++ordenesRequestIdRef.current;
    try {
      const [ordenesData, itemsData] = await Promise.all([
        migaoApi.listarOrdenesAbiertas(),
        migaoApi.listarItemsActivos(),
      ]);
      if (requestId !== ordenesRequestIdRef.current) return;
      setOrdenes(ordenesData);
      setItemsActivos(itemsData);
    } catch (err) {
      if (requestId === ordenesRequestIdRef.current) {
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las órdenes");
      }
    } finally {
      if (requestId === ordenesRequestIdRef.current) setLoading(false);
    }

    const ordenSeleccionadaActual = ordenSeleccionadaIdRef.current;
    if (ordenSeleccionadaActual) {
      try {
        const detalleData = await migaoApi.obtenerDetalle(ordenSeleccionadaActual);
        if (requestId === ordenesRequestIdRef.current) setDetalle(detalleData);
      } catch {
        // Si la orden ya no existe (se cerró/canceló desde otro dispositivo), el
        // detalle se deja como estaba; cerrarYCobrar/seleccionarOrden lo limpian.
      }
    }
  }

  async function cargarHistorial() {
    const requestId = ++historialRequestIdRef.current;
    try {
      const historialData = await migaoApi.listarHistorialOrdenes();
      if (requestId === historialRequestIdRef.current) setHistorial(historialData);
    } catch {
      /* la tabla de historial simplemente queda como estaba; el próximo sondeo reintenta */
    }
  }

  useEffect(() => {
    cargarOrdenes();
    cargarHistorial();
    const intervalo = setInterval(() => {
      cargarOrdenes();
      cargarHistorial();
    }, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(() => Promise.all([cargarOrdenes(), cargarHistorial()]));

  function reiniciarDivision() {
    setDividirCuenta(false);
    setNumPartes(2);
    setAsignaciones({});
    setPagosPartes([{ metodoPago: "efectivo" }, { metodoPago: "efectivo" }]);
  }

  async function seleccionarOrden(ordenId: string) {
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
    setMensaje(null);
    setError(null);
    reiniciarDivision();
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle de la orden");
    }
  }

  const pagoMixtoInvalido =
    pago.metodoPago === "mixto" && detalle !== null && Math.abs(pago.montoEfectivo + pago.montoBanco - detalle.total) > 0.01;

  async function cerrarYCobrar() {
    if (!ordenSeleccionadaId || pagoMixtoInvalido) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await migaoApi.cerrarOrden(ordenSeleccionadaId, pago);
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

  // Una unidad por cada unidad física del producto: "2x Americano" (cantidad
  // entera > 1) se parte en 2 filas de 1 unidad cada una, asignables por
  // separado. Cantidades no enteras (poco comunes en Migao) se dejan como una
  // sola fila — no tiene sentido partir "1.5" en unidades discretas.
  const unidadesCobrables = detalle
    ? detalle.items
        .filter((i) => i.estado !== "cancelado")
        .flatMap((item) => {
          const cantidad = Number(item.cantidad);
          const precioUnitario = Number(item.precio_unitario);
          if (Number.isInteger(cantidad) && cantidad > 1) {
            return Array.from({ length: cantidad }, (_, idx) => ({
              key: `${item.id}-${idx}`,
              itemId: item.id,
              productoNombre: item.producto_nombre,
              cantidadUnidad: 1,
              subtotalUnidad: precioUnitario,
            }));
          }
          return [
            {
              key: `${item.id}-0`,
              itemId: item.id,
              productoNombre: item.producto_nombre,
              cantidadUnidad: cantidad,
              subtotalUnidad: item.subtotal,
            },
          ];
        })
    : [];
  const todosAsignados =
    unidadesCobrables.length > 0 && unidadesCobrables.every((u) => asignaciones[u.key] !== undefined);

  function cambiarNumPartes(n: number) {
    const nuevo = Math.max(2, n);
    setNumPartes(nuevo);
    setPagosPartes((actual) => {
      const copia = actual.slice(0, nuevo);
      while (copia.length < nuevo) copia.push({ metodoPago: "efectivo" });
      return copia;
    });
    // Las unidades que quedaron asignadas a una parte que ya no existe vuelven a quedar sin asignar.
    setAsignaciones((actual) => {
      const copia: Record<string, number> = {};
      for (const [key, parteIdx] of Object.entries(actual)) {
        if (parteIdx < nuevo) copia[key] = parteIdx;
      }
      return copia;
    });
  }

  function subtotalParte(parteIdx: number) {
    return unidadesCobrables
      .filter((u) => asignaciones[u.key] === parteIdx)
      .reduce((acc, u) => acc + u.subtotalUnidad, 0);
  }

  /** Agrupa las unidades de una parte por itemId (una parte puede llevarse
   *  más de una unidad del mismo producto), para mandarle al backend cuánta
   *  cantidad de cada ítem le corresponde. */
  function unidadesAsignadasAParte(parteIdx: number) {
    const porItem = new Map<number, number>();
    for (const u of unidadesCobrables) {
      if (asignaciones[u.key] === parteIdx) {
        porItem.set(u.itemId, (porItem.get(u.itemId) ?? 0) + u.cantidadUnidad);
      }
    }
    return Array.from(porItem.entries()).map(([itemId, cantidad]) => ({ itemId, cantidad }));
  }

  const algunaParteMixtaInvalida = Array.from({ length: numPartes }, (_, idx) => {
    const pagoParte = pagosPartes[idx];
    if (pagoParte.metodoPago !== "mixto") return false;
    return Math.abs(pagoParte.montoEfectivo + pagoParte.montoBanco - subtotalParte(idx)) > 0.01;
  }).some(Boolean);

  async function cerrarYCobrarDividido() {
    if (!ordenSeleccionadaId || !todosAsignados || algunaParteMixtaInvalida) return;
    const partes: (PagoInput & { unidades: { itemId: number; cantidad: number }[] })[] = Array.from(
      { length: numPartes },
      (_, idx) => ({
        ...pagosPartes[idx],
        unidades: unidadesAsignadasAParte(idx),
      }),
    );
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await migaoApi.cerrarOrdenDividida(ordenSeleccionadaId, partes);
      setMensaje(`Orden cobrada y cerrada (cuenta dividida en ${numPartes}). Total: ${formatMoney(resultado.total)}`);
      setDetalle(null);
      setOrdenSeleccionadaId(null);
      reiniciarDivision();
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
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja Migao</h1>
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

              <label className="mb-4 flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                <input
                  type="checkbox"
                  checked={dividirCuenta}
                  onChange={(e) => (e.target.checked ? setDividirCuenta(true) : reiniciarDivision())}
                  disabled={unidadesCobrables.length < 2}
                  className="h-4 w-4"
                />
                Dividir cuenta entre varias personas
              </label>

              {!dividirCuenta ? (
                <>
                  <label className="mb-1 block text-xs font-medium">Método de pago</label>
                  <div className="mb-4">
                    <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={detalle.total} />
                  </div>

                  <button
                    onClick={cerrarYCobrar}
                    disabled={cobrando || pagoMixtoInvalido}
                    className="mb-2 w-full rounded-md bg-brand-green-700 px-3 py-2 text-sm font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                  >
                    {cobrando ? "Cobrando..." : "Cobrar y cerrar orden"}
                  </button>
                </>
              ) : (
                <div className="mb-4 flex flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                      ¿Entre cuántas partes?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => cambiarNumPartes(numPartes - 1)}
                        disabled={numPartes <= 2}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-green-700 font-bold text-brand-green-700 disabled:opacity-40 dark:border-brand-vanilla dark:text-brand-vanilla"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-semibold text-brand-ink dark:text-brand-vanilla">
                        {numPartes}
                      </span>
                      <button
                        type="button"
                        onClick={() => cambiarNumPartes(numPartes + 1)}
                        disabled={numPartes >= unidadesCobrables.length}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-brand-green-700 font-bold text-brand-green-700 disabled:opacity-40 dark:border-brand-vanilla dark:text-brand-vanilla"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">
                      Toca la parte a la que corresponde cada producto:
                    </span>
                    {unidadesCobrables.map((unidad) => (
                      <div key={unidad.key} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-brand-ink dark:text-brand-vanilla">
                          {formatCantidad(unidad.cantidadUnidad)}× {unidad.productoNombre}
                        </span>
                        <div className="flex shrink-0 gap-1">
                          {Array.from({ length: numPartes }, (_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setAsignaciones((actual) => ({ ...actual, [unidad.key]: idx }))}
                              className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-bold ${
                                asignaciones[unidad.key] === idx
                                  ? "border-brand-green-700 bg-brand-green-700 text-brand-vanilla"
                                  : "border-brand-vanilla-dark text-brand-ink/60 dark:border-brand-green-700 dark:text-brand-vanilla/60"
                              }`}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
                    {Array.from({ length: numPartes }, (_, idx) => (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                            Parte {idx + 1}
                          </span>
                          <span className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
                            {formatMoney(subtotalParte(idx))}
                          </span>
                        </div>
                        <SelectorMetodoPago
                          value={pagosPartes[idx]}
                          onChange={(nuevo) =>
                            setPagosPartes((actual) => {
                              const copia = [...actual];
                              copia[idx] = nuevo;
                              return copia;
                            })
                          }
                          totalFijo={subtotalParte(idx)}
                        />
                      </div>
                    ))}
                  </div>

                  {!todosAsignados && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Asigna todos los productos a alguna parte antes de cobrar.
                    </p>
                  )}
                  {algunaParteMixtaInvalida && (
                    <p className="text-xs text-red-600">Alguna parte mixta no cuadra con su subtotal.</p>
                  )}

                  <button
                    onClick={cerrarYCobrarDividido}
                    disabled={cobrando || !todosAsignados || algunaParteMixtaInvalida}
                    className="w-full rounded-md bg-brand-green-700 px-3 py-2 text-sm font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                  >
                    {cobrando ? "Cobrando..." : `Cobrar y cerrar orden (dividida en ${numPartes})`}
                  </button>
                </div>
              )}

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
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2">Fecha y hora</th>
                <th className="px-3 py-2">Total</th>
                {puedeEditarPagos && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 ? (
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
                      <td className="px-3 py-2">{formatMoney(h.total)}</td>
                      {puedeEditarPagos && (
                        <td className="px-3 py-2">
                          {h.estado === "cerrada" && h.movimiento_id != null && (
                            <button
                              onClick={() =>
                                setMovimientoEditando({
                                  tipo: "orden",
                                  movimientoId: h.movimiento_id!,
                                  metodoPagoActual: h.metodo_pago!,
                                  monto: Number(h.total),
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
