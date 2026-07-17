import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type ItemActivo, type OrdenDetalle, type OrdenResumen, type PagoInput } from "../api";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
import { EstadoBadge } from "../components/EstadoBadge";
import { BADGE_POR_ESTADO, BORDE_POR_ESTADO, ETIQUETA_POR_ESTADO, estadoAgregadoOrden } from "../estadoOrden";
import { formatCantidad } from "../format";

const POLL_MS = 8000;

export function MigaoPage() {
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
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
  const [modalAbierto, setModalAbierto] = useState<"cancelar" | null>(null);

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

  useEffect(() => {
    cargarOrdenes();
    const intervalo = setInterval(cargarOrdenes, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargarOrdenes);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la orden");
    } finally {
      setCobrando(false);
    }
  }

  const ordenActual = ordenes.find((o) => o.id === ordenSeleccionadaId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja Migao</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cobro de mesas/órdenes. Cerrar o cancelar una orden es una acción exclusiva del rol Cajero.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <h2 className="font-medium text-brand-green-700 dark:text-brand-vanilla">
            Órdenes abiertas {ordenes.length > 0 && <span className="text-brand-ink/50">({ordenes.length})</span>}
          </h2>

          {loading ? (
            <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
              Cargando...
            </p>
          ) : ordenes.length === 0 ? (
            <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
              No hay órdenes abiertas.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {ordenes.map((o) => {
                const estadoCocina = estadoAgregadoOrden(o.id, itemsActivos);
                const seleccionada = ordenSeleccionadaId === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => seleccionarOrden(o.id)}
                    className={`rounded-lg p-4 text-left transition-colors hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30 ${
                      estadoCocina
                        ? BORDE_POR_ESTADO[estadoCocina]
                        : "border border-brand-vanilla-dark dark:border-brand-green-700"
                    } ${seleccionada ? "bg-brand-green-50 dark:bg-brand-green-700/30" : ""}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                        Mesa {o.mesa_numero ?? "—"}
                        {o.mesa_piso && <span className="text-sm font-normal"> (piso {o.mesa_piso})</span>}
                      </div>
                      {estadoCocina && (
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${BADGE_POR_ESTADO[estadoCocina]}`}
                        >
                          {ETIQUETA_POR_ESTADO[estadoCocina]}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                      {o.mesero_nombre && <span>Mesero: {o.mesero_nombre} · </span>}
                      {o.cliente_nombre && <span>Cliente: {o.cliente_nombre} · </span>}
                      Total {formatMoney(o.total)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="sticky top-4 rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
          <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">
            {ordenActual
              ? `Detalle para cobro · Mesa ${ordenActual.mesa_numero ?? "—"}`
              : "Detalle para cobro"}
          </h2>

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

      {modalAbierto === "cancelar" && ordenSeleccionadaId && (
        <CancelarOrdenModal
          ordenId={ordenSeleccionadaId}
          onCerrar={() => setModalAbierto(null)}
          onCancelada={async (mensajeCancelacion) => {
            setMensaje(mensajeCancelacion);
            setDetalle(null);
            setOrdenSeleccionadaId(null);
            await cargarOrdenes();
          }}
        />
      )}
    </div>
  );
}
