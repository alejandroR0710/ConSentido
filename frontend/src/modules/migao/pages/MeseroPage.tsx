import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { migaoApi, type ItemActivo, type OrdenDetalle, type OrdenItem, type OrdenResumen, type Producto } from "../api";
import { reproducirBeep, reproducirNotificacionSuave } from "../beep";
import { CambiarMesaModal } from "../components/CambiarMesaModal";
import { EditarItemModal } from "../components/EditarItemModal";
import { EstadoBadge } from "../components/EstadoBadge";
import { HistorialOrden } from "../components/HistorialOrden";
import { SelectorProductoModal } from "../components/SelectorProductoModal";
import { BORDE_POR_ESTADO, estadoAgregadoOrden } from "../estadoOrden";
import { formatCantidad } from "../format";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

const POLL_MS = 5000;
// El menú cambia poco (un producto nuevo cada tanto) comparado con el estado de
// las órdenes: refrescarlo cada POLL_MS sería desperdiciar peticiones, pero sin
// ningún refresco periódico un mesero con la app abierta desde antes nunca ve
// productos agregados después de que cargó la página.
const POLL_PRODUCTOS_MS = 60000;

interface ItemBorrador {
  producto: Producto;
  cantidad: number;
  observaciones?: string;
}

type Vista = "lista" | "detalle" | "nueva";

export function MeseroPage() {
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [vista, setVista] = useState<Vista>("lista");
  const [ordenSeleccionadaId, setOrdenSeleccionadaId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<OrdenDetalle | null>(null);

  const [borradorMesaNumero, setBorradorMesaNumero] = useState("");
  const [borradorPersonas, setBorradorPersonas] = useState("");
  const [borradorPiso, setBorradorPiso] = useState<1 | 2>(1);
  const [borradorItems, setBorradorItems] = useState<ItemBorrador[]>([]);
  const [creandoOrden, setCreandoOrden] = useState(false);

  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const [agregandoId, setAgregandoId] = useState<string | null>(null);
  const [itemEditando, setItemEditando] = useState<OrdenItem | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [cambiarMesaAbierto, setCambiarMesaAbierto] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [notificaciones, setNotificaciones] = useState<{ id: number; texto: string }[]>([]);
  const [itemsActivos, setItemsActivos] = useState<ItemActivo[]>([]);

  const estadosPreviosRef = useRef<Map<number, string>>(new Map());
  // Qué órdenes ya sonaron como "lista", para no repetir el sonido en cada poll
  // mientras siga lista; se libera si vuelve a tener algo pendiente/preparando
  // (ej. el mesero agrega o edita un producto), así puede volver a sonar después.
  const ordenesListoNotificadasRef = useRef<Set<string>>(new Set());
  const notifIdRef = useRef(0);
  const ordenSeleccionadaRef = useRef<string | null>(null);
  ordenSeleccionadaRef.current = ordenSeleccionadaId;

  async function cargarOrdenes() {
    try {
      setOrdenes(await migaoApi.listarOrdenesAbiertas());
    } catch {
      /* se reintenta en el próximo poll */
    }
  }

  async function cargarProductos() {
    try {
      setProductos(await migaoApi.listarProductos());
    } catch {
      /* el buscador de productos simplemente queda vacío */
    }
  }

  async function cargarDetalle(ordenId: string) {
    try {
      setDetalle(await migaoApi.obtenerDetalle(ordenId));
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        // La orden ya no existe (ej. Super Root reinició el historial de órdenes
        // mientras el mesero la tenía abierta) — quedarse mostrando el detalle
        // viejo con un error encima solo confunde, mejor volver a la lista sola.
        irALista();
        setError("Esta orden ya no existe (puede que se haya reiniciado el historial).");
        return;
      }
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la orden");
    }
  }

  async function revisarNotificaciones() {
    let activos;
    try {
      activos = await migaoApi.listarItemsActivos();
    } catch {
      return;
    }
    setItemsActivos(activos);

    const anteriores = estadosPreviosRef.current;
    const nuevas: string[] = [];
    for (const item of activos) {
      const previo = anteriores.get(item.id);
      if (previo && previo !== item.estado && (item.estado === "preparando" || item.estado === "listo")) {
        nuevas.push(
          `Mesa ${item.mesa_numero ?? "—"} · Comensal ${item.comensal_numero}: ${item.producto_nombre} está ${item.estado}`,
        );
      }
      anteriores.set(item.id, item.estado);
    }
    if (nuevas.length > 0) {
      reproducirBeep();
      setNotificaciones((actual) =>
        [...nuevas.map((texto) => ({ id: notifIdRef.current++, texto })), ...actual].slice(0, 6),
      );
    }

    // Sonido suave aparte, específico de "la orden completa ya está lista" (no
    // por cada ítem individual): se dispara una sola vez por orden mientras siga
    // lista, y se libera si vuelve a tener algo pendiente/preparando.
    const ordenesConItems = new Set(activos.map((i) => i.orden_id));
    for (const ordenId of ordenesConItems) {
      const estado = estadoAgregadoOrden(ordenId, activos);
      if (estado === "listo") {
        if (!ordenesListoNotificadasRef.current.has(ordenId)) {
          ordenesListoNotificadasRef.current.add(ordenId);
          reproducirNotificacionSuave();
        }
      } else {
        ordenesListoNotificadasRef.current.delete(ordenId);
      }
    }
  }

  useEffect(() => {
    cargarProductos();
    cargarOrdenes();
    revisarNotificaciones();
    const intervalo = setInterval(() => {
      cargarOrdenes();
      revisarNotificaciones();
      if (ordenSeleccionadaRef.current) cargarDetalle(ordenSeleccionadaRef.current);
    }, POLL_MS);
    const intervaloProductos = setInterval(cargarProductos, POLL_PRODUCTOS_MS);
    return () => {
      clearInterval(intervalo);
      clearInterval(intervaloProductos);
    };
  }, []);

  useRegistrarRefresco(async () => {
    await Promise.all([cargarProductos(), cargarOrdenes(), revisarNotificaciones()]);
    if (ordenSeleccionadaRef.current) await cargarDetalle(ordenSeleccionadaRef.current);
  });

  function irALista() {
    setVista("lista");
    setOrdenSeleccionadaId(null);
    setDetalle(null);
  }

  function iniciarNuevaOrden() {
    setVista("nueva");
    setBorradorMesaNumero("");
    setBorradorPersonas("");
    setBorradorPiso(1);
    setBorradorItems([]);
    setError(null);
    setMensaje(null);
  }

  function quitarDelBorrador(index: number) {
    setBorradorItems((actual) => actual.filter((_, i) => i !== index));
  }

  async function confirmarCrearOrden() {
    if (!borradorMesaNumero.trim() || borradorItems.length === 0) return;
    setCreandoOrden(true);
    setError(null);
    setMensaje(null);
    try {
      const personas = borradorPersonas.trim() ? Number(borradorPersonas) : undefined;
      const orden = await migaoApi.crearOrden(
        borradorMesaNumero.trim(),
        borradorItems.map((i) => ({
          productoId: i.producto.id,
          cantidad: i.cantidad,
          precioUnitario: Number(i.producto.precio),
          observaciones: i.observaciones,
        })),
        personas,
        borradorPiso,
      );
      setMensaje(`Orden creada — Mesa ${borradorMesaNumero} (piso ${borradorPiso}) · Comensal ${orden.comensal_numero}`);
      setBorradorMesaNumero("");
      setBorradorPersonas("");
      setBorradorPiso(1);
      setBorradorItems([]);
      await cargarOrdenes();
      setOrdenSeleccionadaId(orden.id);
      await cargarDetalle(orden.id);
      setVista("detalle");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la orden");
    } finally {
      setCreandoOrden(false);
    }
  }

  async function seleccionarOrden(ordenId: string) {
    setVista("detalle");
    setOrdenSeleccionadaId(ordenId);
    setError(null);
    setMensaje(null);
    await cargarDetalle(ordenId);
  }

  function manejarSeleccionProducto(producto: Producto, cantidad: number, observaciones?: string) {
    if (vista === "nueva") {
      setBorradorItems((actual) => {
        // Solo se suma a una línea existente si ninguna de las dos tiene
        // observación: "limonada" y "limonada sin azúcar" son pedidos distintos,
        // no se pueden fusionar en una sola cantidad sin perder la nota.
        const idx = !observaciones
          ? actual.findIndex((i) => i.producto.id === producto.id && !i.observaciones)
          : -1;
        if (idx >= 0) {
          const copia = [...actual];
          copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cantidad };
          return copia;
        }
        return [...actual, { producto, cantidad, observaciones }];
      });
      return;
    }
    agregarProducto(producto, cantidad, observaciones);
  }

  async function agregarProducto(producto: Producto, cantidad: number, observaciones?: string) {
    if (!ordenSeleccionadaId) return;
    setAgregandoId(producto.id);
    setError(null);
    try {
      await migaoApi.agregarItem(ordenSeleccionadaId, producto.id, cantidad, Number(producto.precio), observaciones);
      await cargarDetalle(ordenSeleccionadaId);
      await cargarOrdenes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo agregar el producto");
    } finally {
      setAgregandoId(null);
    }
  }

  async function guardarCantidad(itemId: number, cantidad: number) {
    if (!ordenSeleccionadaId) return;
    try {
      await migaoApi.editarCantidadItem(itemId, cantidad);
      await cargarDetalle(ordenSeleccionadaId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo editar el ítem");
      throw err;
    }
  }

  async function cancelarItem(itemId: number) {
    if (!ordenSeleccionadaId) return;
    try {
      await migaoApi.cancelarItem(itemId);
      await cargarDetalle(ordenSeleccionadaId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cancelar el ítem");
      throw err;
    }
  }

  async function entregarItem(itemId: number) {
    if (!ordenSeleccionadaId) return;
    try {
      await migaoApi.entregarItem(itemId);
      await cargarDetalle(ordenSeleccionadaId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar como entregado");
    }
  }

  async function guardarNuevaMesa(mesaNumero: string, piso: number) {
    if (!ordenSeleccionadaId) return;
    try {
      await migaoApi.cambiarMesa(ordenSeleccionadaId, mesaNumero, piso);
      await cargarOrdenes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar la mesa");
      throw err;
    }
  }

  const totalBorrador = borradorItems.reduce((acc, i) => acc + i.cantidad * Number(i.producto.precio), 0);
  const ordenActual = ordenes.find((o) => o.id === ordenSeleccionadaId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Mesero</h1>
            {vista === "lista" && (
              <Link
                to="/mesero/historial"
                className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              >
                🧾 Historial
              </Link>
            )}
          </div>
          {vista === "lista" && (
            <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
              Toca una orden para verla, o crea una nueva.
            </p>
          )}
        </div>
        {vista === "lista" && (
          <button
            onClick={iniciarNuevaOrden}
            className="rounded-md bg-brand-green-700 px-4 py-2 font-medium text-brand-vanilla hover:bg-brand-green-600"
          >
            + Nueva orden
          </button>
        )}
      </div>

      {notificaciones.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-amber-700 dark:text-amber-300">🔔 Cocina actualizó pedidos</span>
            <button onClick={() => setNotificaciones([])} className="text-xs underline">
              Limpiar
            </button>
          </div>
          {notificaciones.map((n) => (
            <p key={n.id} className="text-sm text-brand-ink dark:text-brand-vanilla">
              {n.texto}
            </p>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      {vista === "lista" && (
        <div className="flex flex-col gap-2">
          {ordenes.length === 0 ? (
            <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
              No hay órdenes abiertas. Crea una con "+ Nueva orden".
            </p>
          ) : (
            ordenes.map((o) => {
              const estadoCocina = estadoAgregadoOrden(o.id, itemsActivos);
              return (
                <button
                  key={o.id}
                  onClick={() => seleccionarOrden(o.id)}
                  className={`rounded-lg p-4 text-left hover:bg-brand-green-50 dark:hover:bg-brand-green-700/30 ${
                    estadoCocina ? BORDE_POR_ESTADO[estadoCocina] : "border border-brand-vanilla-dark dark:border-brand-green-700"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                      Mesa {o.mesa_numero ?? "—"}
                      {o.mesa_piso && <span className="text-sm font-normal"> (piso {o.mesa_piso})</span>} · Comensal{" "}
                      {o.comensal_numero}
                      {o.numero_personas && (
                        <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                          👥 {o.numero_personas}
                        </span>
                      )}
                    </div>
                    {estadoCocina === "listo" && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-green-600 px-2 py-0.5 text-xs font-bold text-brand-vanilla">
                        ✓ Lista
                      </span>
                    )}
                    {estadoCocina === "preparando" && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                        Preparando
                      </span>
                    )}
                    {estadoCocina === "pendiente" && (
                      <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-400 px-2 py-0.5 text-xs font-bold text-white">
                        En espera
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                    {formatearHora(o.created_at)} · {o.estado} · Total {formatMoney(o.total)}
                    {o.mesero_nombre && <span> · Mesero: {o.mesero_nombre}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      {vista === "nueva" && (
        <div className="flex flex-col gap-4">
          <button onClick={irALista} className="self-start text-sm text-brand-green-700 dark:text-brand-vanilla">
            ← Volver
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Número de mesa</label>
              <input
                autoFocus
                inputMode="numeric"
                value={borradorMesaNumero}
                onChange={(e) => setBorradorMesaNumero(e.target.value)}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                placeholder="Ej. 7"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Piso</label>
              <div className="flex overflow-hidden rounded-md border border-brand-vanilla-dark dark:border-brand-green-700">
                {([1, 2] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setBorradorPiso(p)}
                    className={`flex-1 py-2 text-sm font-semibold ${
                      borradorPiso === p
                        ? "bg-brand-green-700 text-brand-vanilla"
                        : "bg-brand-vanilla text-brand-ink hover:bg-brand-green-50 dark:bg-brand-green-900 dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
                    }`}
                  >
                    Piso {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Personas (opcional)</label>
              <input
                inputMode="numeric"
                value={borradorPersonas}
                onChange={(e) => setBorradorPersonas(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                placeholder="Ej. 4"
              />
            </div>
          </div>

          <button
            onClick={() => setSelectorAbierto(true)}
            className="w-full rounded-md border-2 border-brand-green-700 px-4 py-3 text-base font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
          >
            + Agregar producto
          </button>

          {borradorItems.length === 0 ? (
            <p className="text-sm text-brand-ink/60">Aún no has agregado productos.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {borradorItems.map((i, idx) => (
                <li
                  key={`${i.producto.id}-${idx}`}
                  className="flex items-center justify-between rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700"
                >
                  <div>
                    <span className="font-medium text-brand-ink dark:text-brand-vanilla">
                      {i.cantidad}× {i.producto.nombre}
                    </span>
                    {i.observaciones && (
                      <div className="text-xs italic text-brand-ink/60 dark:text-brand-vanilla/60">
                        {i.observaciones}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                      {formatMoney(i.cantidad * Number(i.producto.precio))}
                    </span>
                    <button onClick={() => quitarDelBorrador(idx)} className="text-xs text-red-600 hover:underline">
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-brand-vanilla-dark pt-3 text-base font-semibold dark:border-brand-green-700">
            <span>Total</span>
            <span>{formatMoney(totalBorrador)}</span>
          </div>

          <button
            onClick={confirmarCrearOrden}
            disabled={creandoOrden || !borradorMesaNumero.trim() || borradorItems.length === 0}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {creandoOrden ? "Creando..." : "Crear orden"}
          </button>
        </div>
      )}

      {vista === "detalle" && detalle && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button onClick={irALista} className="text-sm text-brand-green-700 dark:text-brand-vanilla">
              ← Volver
            </button>
            <button
              onClick={() => setHistorialAbierto(true)}
              className="text-sm text-brand-green-700 underline dark:text-brand-vanilla"
            >
              Ver historial
            </button>
          </div>

          <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
            <span>
              Mesa {ordenActual?.mesa_numero ?? "—"}
              {ordenActual?.mesa_piso && <span className="text-sm font-normal"> (piso {ordenActual.mesa_piso})</span>} ·
              Comensal {detalle.orden.comensal_numero}
              {detalle.orden.numero_personas && (
                <span className="ml-2 text-sm font-normal text-brand-ink/60 dark:text-brand-vanilla/60">
                  👥 {detalle.orden.numero_personas}
                </span>
              )}
            </span>
            <button
              onClick={() => setCambiarMesaAbierto(true)}
              aria-label="Cambiar mesa"
              className="rounded-md px-1.5 py-1 text-sm text-brand-ink/60 hover:bg-brand-green-50 dark:text-brand-vanilla/60 dark:hover:bg-brand-green-700/40"
            >
              ✏️
            </button>
          </h2>
          {ordenActual?.mesero_nombre && (
            <p className="-mt-3 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
              Mesero: {ordenActual.mesero_nombre}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {detalle.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700"
              >
                <div>
                  <div className="text-base font-semibold text-brand-ink dark:text-brand-vanilla">
                    {formatCantidad(item.cantidad)}× {item.producto_nombre}
                  </div>
                  {item.observaciones && (
                    <div className="mb-1 text-xs italic text-brand-ink/60 dark:text-brand-vanilla/60">
                      {item.observaciones}
                    </div>
                  )}
                  <EstadoBadge estado={item.estado} />
                </div>
                <div className="flex shrink-0 gap-2">
                  {item.estado === "listo" && (
                    <button
                      onClick={() => entregarItem(item.id)}
                      className="rounded-md bg-brand-green-700 px-3 py-2 text-sm text-brand-vanilla hover:bg-brand-green-600"
                    >
                      Entregado
                    </button>
                  )}
                  {item.estado !== "cancelado" && item.estado !== "servido" && (
                    <button
                      onClick={() => setItemEditando(item)}
                      aria-label="Editar producto"
                      className="rounded-md border border-brand-vanilla-dark px-3 py-2 text-sm dark:border-brand-green-700"
                    >
                      ✏️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-brand-vanilla-dark pt-3 text-base font-semibold dark:border-brand-green-700">
            <span>Total</span>
            <span>{formatMoney(detalle.total)}</span>
          </div>

          <button
            onClick={() => setSelectorAbierto(true)}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 text-base font-semibold text-brand-vanilla hover:bg-brand-green-600"
          >
            + Agregar producto
          </button>
        </div>
      )}

      {selectorAbierto && (
        <SelectorProductoModal
          productos={productos}
          agregandoId={agregandoId}
          onCerrar={() => setSelectorAbierto(false)}
          onSeleccionar={manejarSeleccionProducto}
        />
      )}

      {itemEditando && (
        <EditarItemModal
          item={itemEditando}
          onCerrar={() => setItemEditando(null)}
          onGuardar={(cantidad) => guardarCantidad(itemEditando.id, cantidad)}
          onCancelarProducto={() => cancelarItem(itemEditando.id)}
        />
      )}

      {historialAbierto && detalle && (
        <Modal titulo="Historial de esta orden" onCerrar={() => setHistorialAbierto(false)}>
          <HistorialOrden entradas={detalle.historial} />
        </Modal>
      )}

      {cambiarMesaAbierto && (
        <CambiarMesaModal
          mesaActual={ordenActual?.mesa_numero ?? null}
          pisoActual={ordenActual?.mesa_piso ?? null}
          onCerrar={() => setCambiarMesaAbierto(false)}
          onGuardar={guardarNuevaMesa}
        />
      )}
    </div>
  );
}
