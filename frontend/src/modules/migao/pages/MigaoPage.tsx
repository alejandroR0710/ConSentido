import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { CalculadoraVuelta } from "../../../shared/components/CalculadoraVuelta";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type ItemActivo, type OrdenDetalle, type OrdenResumen, type PagoInput } from "../api";
import { AgregarParaLlevarModal } from "../components/AgregarParaLlevarModal";
import { CancelarOrdenModal } from "../components/CancelarOrdenModal";
import { EstadoBadge } from "../components/EstadoBadge";
import { BADGE_POR_ESTADO, BORDE_POR_ESTADO, ETIQUETA_POR_ESTADO, estadoAgregadoOrden } from "../estadoOrden";
import { formatCantidad } from "../format";

const POLL_MS = 8000;

/** Cuánto de lo que se está cobrando es efectivo (para la calculadora de
 *  vuelta): el total completo si el método es puro efectivo, la porción
 *  correspondiente si es mixto, o 0 si es puro banco. */
function montoEfectivoRequerido(pago: MetodoPagoValor, totalSiEsSimple: number): number {
  if (pago.metodoPago === "efectivo") return totalSiEsSimple;
  if (pago.metodoPago === "mixto") return pago.montoEfectivo;
  return 0;
}

export function MigaoPage() {
  const { usuario } = useAuth();
  // "Pago administrativo" (no genera ingreso en Caja General) es exclusivo de
  // Root/Super Root — Cajero cobra normal.
  const puedeAdministrativo = tieneAccesoTotal(usuario?.rol);

  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [itemsActivos, setItemsActivos] = useState<ItemActivo[]>([]);
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<OrdenDetalle | null>(null);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  // "Pago administrativo": no genera ingreso en Caja General, exclusivo de
  // Root/Super Root. Aparte del selector normal (efectivo/banco/mixto) porque
  // ese tipo se comparte con Caja General, que nunca debe ofrecer esta opción.
  const [esAdministrativo, setEsAdministrativo] = useState(false);
  // % de descuento sobre el total — solo aplica al cobro simple, no a cuenta
  // dividida (ver migao.schema.ts::cerrarOrdenSchema).
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(0);
  // Cuánto dijo el cliente que entregaba en efectivo — solo para calcular la
  // vuelta en pantalla, no se envía al backend (ver CalculadoraVuelta).
  const [montoRecibido, setMontoRecibido] = useState(0);
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
  const [montosRecibidosPartes, setMontosRecibidosPartes] = useState<number[]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState<"cancelar" | "para-llevar" | null>(null);

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
    setMontosRecibidosPartes([0, 0]);
  }

  async function seleccionarOrden(ordenId: string) {
    setOrdenSeleccionadaId(ordenId);
    setDetalle(null);
    setMensaje(null);
    setError(null);
    setPago({ metodoPago: "efectivo" });
    setMontoRecibido(0);
    setDescuentoPorcentaje(0);
    setEsAdministrativo(false);
    reiniciarDivision();
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle de la orden");
    }
  }

  function volverALista() {
    setOrdenSeleccionadaId(null);
    setDetalle(null);
    setError(null);
    setMensaje(null);
  }

  /** Recarga el detalle sin tocar el método de pago ni la división ya elegidos
   *  — a diferencia de seleccionarOrden(), que sí los reinicia porque cambia
   *  de orden. Se usa después de agregar un cargo de "para llevar". */
  async function refrescarDetalle() {
    if (!ordenSeleccionadaId) return;
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenSeleccionadaId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el detalle de la orden");
    }
  }

  // El descuento se aplica ANTES de elegir método de pago: el selector y la
  // calculadora de vuelta siempre trabajan contra el total ya descontado.
  const totalConDescuento = detalle ? detalle.total * (1 - descuentoPorcentaje / 100) : 0;

  const pagoMixtoInvalido =
    !esAdministrativo &&
    pago.metodoPago === "mixto" &&
    detalle !== null &&
    Math.abs(pago.montoEfectivo + pago.montoBanco - totalConDescuento) > 0.01;

  async function cerrarYCobrar() {
    if (!ordenSeleccionadaId || pagoMixtoInvalido) return;
    setCobrando(true);
    setError(null);
    setMensaje(null);
    try {
      const resultado = await migaoApi.cerrarOrden(
        ordenSeleccionadaId,
        esAdministrativo ? { metodoPago: "administrativo" } : pago,
        descuentoPorcentaje > 0 ? descuentoPorcentaje : undefined,
      );
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
    setMontosRecibidosPartes((actual) => {
      const copia = actual.slice(0, nuevo);
      while (copia.length < nuevo) copia.push(0);
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

  /** Al activar "Dividir cuenta", arranca en tantas partes como comensales se
   *  registraron al crear la orden (numero_personas) — no siempre en 2 —
   *  ajustado a los límites válidos (mínimo 2, máximo una por unidad cobrable). */
  function activarDivision() {
    const personasRegistradas = detalle?.orden.numero_personas ?? 0;
    const partesIniciales = Math.min(
      Math.max(2, personasRegistradas || 2),
      Math.max(2, unidadesCobrables.length),
    );
    cambiarNumPartes(partesIniciales);
    setDividirCuenta(true);
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
  const mostrarCobro = ordenSeleccionadaId !== null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja Migao</h1>
          {puedeAdministrativo && !mostrarCobro && (
            <Link
              to="/migao/historial"
              className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            >
              🧾 Historial
            </Link>
          )}
        </div>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cobro de mesas/órdenes. Cerrar o cancelar una orden es una acción exclusiva del rol Cajero.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      {!mostrarCobro ? (
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
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ordenes.map((o) => {
                const estadoCocina = estadoAgregadoOrden(o.id, itemsActivos);
                return (
                  <button
                    key={o.id}
                    onClick={() => seleccionarOrden(o.id)}
                    className={`rounded-lg p-4 text-left transition-colors hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30 ${
                      estadoCocina
                        ? BORDE_POR_ESTADO[estadoCocina]
                        : "border border-brand-vanilla-dark dark:border-brand-green-700"
                    }`}
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
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <button
            onClick={volverALista}
            className="self-start text-sm font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ← Volver a órdenes
          </button>

          <h2 className="-mt-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            {ordenActual ? `Mesa ${ordenActual.mesa_numero ?? "—"}` : "Cobro"}
            {ordenActual?.mesero_nombre && (
              <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                Mesero: {ordenActual.mesero_nombre}
              </span>
            )}
          </h2>

          {!detalle ? (
            <p className="text-sm text-brand-ink/60">Cargando detalle...</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {detalle.items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      item.es_para_llevar
                        ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/20"
                        : "border-brand-vanilla-dark dark:border-brand-green-700"
                    }`}
                  >
                    <div>
                      <div className="text-base font-medium text-brand-ink dark:text-brand-vanilla">
                        {item.es_para_llevar && "🥡 "}
                        {formatCantidad(item.cantidad)}× {item.producto_nombre}
                      </div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {formatMoney(item.precio_unitario)} c/u
                      </div>
                      {item.observaciones && (
                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                          ⚠ {item.observaciones}
                        </div>
                      )}
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

              <button
                onClick={() => setModalAbierto("para-llevar")}
                className="w-full rounded-md border border-amber-400 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                🥡 Agregar para llevar
              </button>

              {detalle.items.some((i) => i.estado === "pendiente" || i.estado === "preparando") && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  Todavía hay productos en cocina sin terminar.
                </p>
              )}

              <div className="flex flex-col gap-2 rounded-lg bg-brand-green-50 px-4 py-3 dark:bg-brand-green-700/20">
                {descuentoPorcentaje > 0 && (
                  <div className="flex items-center justify-between text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                    <span>Sin descuento</span>
                    <span className="line-through">{formatMoney(detalle.total)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-brand-ink dark:text-brand-vanilla">Total</span>
                  <span className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                    {formatMoney(totalConDescuento)}
                  </span>
                </div>
              </div>

              {!dividirCuenta && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-brand-ink dark:text-brand-vanilla">Descuento %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                    value={descuentoPorcentaje || ""}
                    onChange={(e) => setDescuentoPorcentaje(Math.min(100, Math.max(0, Number(e.target.value))))}
                    placeholder="0"
                    className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                  />
                </div>
              )}

              <label className="flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                <input
                  type="checkbox"
                  checked={dividirCuenta}
                  onChange={(e) => (e.target.checked ? activarDivision() : reiniciarDivision())}
                  disabled={unidadesCobrables.length < 2}
                  className="h-4 w-4"
                />
                Dividir cuenta entre varias personas
                {!dividirCuenta && Boolean(detalle?.orden.numero_personas) && (
                  <span className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                    (sugerido: {detalle!.orden.numero_personas} comensal
                    {detalle!.orden.numero_personas === 1 ? "" : "es"})
                  </span>
                )}
              </label>

              {!dividirCuenta ? (
                <>
                  {puedeAdministrativo && (
                    <label className="flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
                      <input
                        type="checkbox"
                        checked={esAdministrativo}
                        onChange={(e) => setEsAdministrativo(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Pago administrativo (no cuenta en Caja General)
                    </label>
                  )}

                  {esAdministrativo ? (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                      ⚠ Esta cuenta no generará ingreso en Caja General — solo queda en el historial administrativo.
                    </p>
                  ) : (
                    <>
                      <label className="-mb-2 block text-xs font-medium">Método de pago</label>
                      <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={totalConDescuento} />

                      {pago.metodoPago !== "banco" && (
                        <CalculadoraVuelta
                          aPagar={montoEfectivoRequerido(pago, totalConDescuento)}
                          recibido={montoRecibido}
                          onChange={setMontoRecibido}
                        />
                      )}
                    </>
                  )}

                  <button
                    onClick={cerrarYCobrar}
                    disabled={cobrando || pagoMixtoInvalido}
                    className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                  >
                    {cobrando ? "Cobrando..." : "Cobrar y cerrar orden"}
                  </button>
                </>
              ) : (
                <div className="flex flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
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
                      <div key={idx} className="flex flex-col gap-2">
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
                        {pagosPartes[idx].metodoPago !== "banco" && (
                          <CalculadoraVuelta
                            aPagar={montoEfectivoRequerido(pagosPartes[idx], subtotalParte(idx))}
                            recibido={montosRecibidosPartes[idx] ?? 0}
                            onChange={(valor) =>
                              setMontosRecibidosPartes((actual) => {
                                const copia = [...actual];
                                copia[idx] = valor;
                                return copia;
                              })
                            }
                          />
                        )}
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
                    className="w-full rounded-md bg-brand-green-700 px-3 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
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
          }}
        />
      )}

      {modalAbierto === "para-llevar" && ordenSeleccionadaId && (
        <AgregarParaLlevarModal
          ordenId={ordenSeleccionadaId}
          onCerrar={() => setModalAbierto(null)}
          onAgregado={refrescarDetalle}
        />
      )}
    </div>
  );
}
