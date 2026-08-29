import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { migaoApi, type CotizacionDetalle, type CotizacionResumen, type Producto } from "../api";

interface LineaCotizacion {
  key: number;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

let siguienteKey = 1;
function lineaVacia(): LineaCotizacion {
  return { key: siguienteKey++, nombre: "", cantidad: 1, precioUnitario: 0 };
}

function formatearFecha(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cotizacionAReciboProps(cotizacion: CotizacionDetalle) {
  const camposEncabezado: { etiqueta: string; valor: string }[] = [];
  if (cotizacion.cliente_nombre) camposEncabezado.push({ etiqueta: "Cliente", valor: cotizacion.cliente_nombre });
  if (cotizacion.cliente_telefono) camposEncabezado.push({ etiqueta: "Teléfono", valor: cotizacion.cliente_telefono });

  return {
    tipo: "cotizacion" as const,
    folio: cotizacion.numero,
    fecha: cotizacion.created_at,
    camposEncabezado,
    items: cotizacion.items.map((item) => ({
      nombre: item.nombre,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
    })),
    subtotal: Number(cotizacion.subtotal),
    total: Number(cotizacion.total),
    nota: cotizacion.nota,
  };
}

/**
 * Cotización: presupuesto para un cliente ANTES de que exista una orden
 * real — no toca inventario/caja/ordenes (ver migao_cotizaciones en
 * schema.sql). Las líneas se pueden escribir libres o autocompletar desde el
 * catálogo de Migao como atajo (si el rol no tiene acceso al catálogo, el
 * campo sigue funcionando como texto libre normal).
 */
export function CotizacionesPage() {
  const [catalogo, setCatalogo] = useState<Producto[]>([]);
  const [cotizaciones, setCotizaciones] = useState<CotizacionResumen[]>([]);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [nota, setNota] = useState("");
  const [lineas, setLineas] = useState<LineaCotizacion[]>([lineaVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // Cotización que se está editando (reemplaza sus datos por completo al
  // guardar) — null significa que el formulario de arriba está creando una
  // cotización nueva, igual que siempre.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNumero, setEditandoNumero] = useState<string | null>(null);
  const [cargandoEdicion, setCargandoEdicion] = useState<string | null>(null);

  const [recibo, setRecibo] = useState<ReturnType<typeof cotizacionAReciboProps> | null>(null);
  const [errorImprimir, setErrorImprimir] = useState<string | null>(null);

  async function cargarCotizaciones() {
    try {
      setCotizaciones(await migaoApi.listarCotizaciones());
      setErrorLista(null);
    } catch (err) {
      setErrorLista(err instanceof ApiError ? err.message : "No se pudo cargar el historial de cotizaciones");
    } finally {
      setCargandoLista(false);
    }
  }

  useEffect(() => {
    cargarCotizaciones();
    // El catálogo es solo un atajo de autocompletar — si el rol no tiene
    // acceso (ej. Cajero no ve el menú completo), la línea sigue siendo texto libre.
    migaoApi
      .listarProductos()
      .then(setCatalogo)
      .catch(() => setCatalogo([]));
  }, []);

  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0);
  const lineasValidas = lineas.filter((l) => l.nombre.trim().length > 0 && l.cantidad > 0);
  const puedeGuardar = lineasValidas.length > 0 && !guardando;

  function actualizarLinea(key: number, cambios: Partial<LineaCotizacion>) {
    setLineas((actual) => actual.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function elegirDelCatalogo(key: number, nombreProducto: string) {
    const producto = catalogo.find((p) => p.nombre === nombreProducto);
    if (!producto) {
      actualizarLinea(key, { nombre: nombreProducto });
      return;
    }
    actualizarLinea(key, { nombre: producto.nombre, precioUnitario: Number(producto.precio) });
  }

  function quitarLinea(key: number) {
    setLineas((actual) => (actual.length > 1 ? actual.filter((l) => l.key !== key) : actual));
  }

  function limpiarFormulario() {
    setClienteNombre("");
    setClienteTelefono("");
    setNota("");
    setLineas([lineaVacia()]);
    setEditandoId(null);
    setEditandoNumero(null);
  }

  async function guardarCotizacion() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setErrorGuardar(null);
    const datos = {
      clienteNombre: clienteNombre.trim() || undefined,
      clienteTelefono: clienteTelefono.trim() || undefined,
      nota: nota.trim() || undefined,
      items: lineasValidas.map((l) => ({
        nombre: l.nombre.trim(),
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
      })),
    };
    try {
      const guardada = editandoId
        ? await migaoApi.editarCotizacion(editandoId, datos)
        : await migaoApi.crearCotizacion(datos);
      limpiarFormulario();
      setRecibo(cotizacionAReciboProps(guardada));
      await cargarCotizaciones();
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No se pudo guardar la cotización");
    } finally {
      setGuardando(false);
    }
  }

  /** Carga una cotización guardada en el formulario de arriba para modificarla
   *  (agregar/quitar/cambiar líneas, cliente o nota) — al guardar se reemplaza
   *  por completo, conservando el mismo número y fecha de creación. */
  async function empezarEdicion(id: string) {
    setCargandoEdicion(id);
    setErrorLista(null);
    try {
      const detalle = await migaoApi.obtenerCotizacion(id);
      setClienteNombre(detalle.cliente_nombre ?? "");
      setClienteTelefono(detalle.cliente_telefono ?? "");
      setNota(detalle.nota ?? "");
      setLineas(
        detalle.items.length > 0
          ? detalle.items.map((item) => ({
              key: siguienteKey++,
              nombre: item.nombre,
              cantidad: Number(item.cantidad),
              precioUnitario: Number(item.precio_unitario),
            }))
          : [lineaVacia()],
      );
      setEditandoId(detalle.id);
      setEditandoNumero(detalle.numero);
      setErrorGuardar(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErrorLista(err instanceof ApiError ? err.message : "No se pudo abrir la cotización para editar");
    } finally {
      setCargandoEdicion(null);
    }
  }

  async function imprimirCotizacion(id: string) {
    setErrorImprimir(null);
    try {
      const detalle = await migaoApi.obtenerCotizacion(id);
      setRecibo(cotizacionAReciboProps(detalle));
    } catch (err) {
      setErrorImprimir(err instanceof ApiError ? err.message : "No se pudo abrir la cotización");
    }
  }

  async function eliminarCotizacion(id: string) {
    try {
      await migaoApi.eliminarCotizacion(id);
      if (editandoId === id) limpiarFormulario();
      await cargarCotizaciones();
    } catch (err) {
      setErrorLista(err instanceof ApiError ? err.message : "No se pudo eliminar la cotización");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/migao" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Cotizaciones</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Presupuesto para un cliente — no genera venta, no toca inventario ni Caja General.
        </p>
      </div>

      <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-brand-green-700 dark:text-brand-vanilla">
            {editandoId ? `Editando cotización Nº ${editandoNumero}` : "Nueva cotización"}
          </h2>
          {editandoId && (
            <button
              type="button"
              onClick={limpiarFormulario}
              className="text-sm text-brand-ink/60 hover:underline dark:text-brand-vanilla/60"
            >
              Cancelar edición
            </button>
          )}
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Cliente (opcional)</label>
            <input
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Teléfono (opcional)</label>
            <input
              value={clienteTelefono}
              onChange={(e) => setClienteTelefono(e.target.value)}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>
        </div>

        <datalist id="catalogo-cotizacion">
          {catalogo.map((p) => (
            <option key={p.id} value={p.nombre} />
          ))}
        </datalist>

        <div className="mb-2 flex flex-col gap-2">
          {lineas.map((linea) => (
            <div key={linea.key} className="flex flex-wrap items-center gap-2">
              <input
                value={linea.nombre}
                onChange={(e) => elegirDelCatalogo(linea.key, e.target.value)}
                list="catalogo-cotizacion"
                placeholder="Producto o servicio"
                className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <input
                type="number"
                min={1}
                value={linea.cantidad}
                onChange={(e) => actualizarLinea(linea.key, { cantidad: Math.max(1, Number(e.target.value)) })}
                className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <MoneyInput
                value={linea.precioUnitario}
                onChange={(v) => actualizarLinea(linea.key, { precioUnitario: v })}
                placeholder="Precio"
                className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <span className="w-24 text-right text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
                {formatMoney(linea.cantidad * linea.precioUnitario)}
              </span>
              <button
                type="button"
                onClick={() => quitarLinea(linea.key)}
                disabled={lineas.length === 1}
                className="rounded-md px-2 py-1 text-lg text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-950/30"
                aria-label="Quitar línea"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLineas((actual) => [...actual, lineaVacia()])}
          className="mb-3 text-sm text-brand-green-700 hover:underline dark:text-brand-vanilla"
        >
          + Agregar línea
        </button>

        <div>
          <label className="mb-1 block text-xs font-medium">Nota (opcional)</label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            className="mb-3 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>

        <div className="mb-3 flex items-center justify-between text-lg font-bold text-brand-green-700 dark:text-brand-vanilla">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>

        {errorGuardar && <p className="mb-2 text-sm text-red-600">{errorGuardar}</p>}

        <button
          onClick={guardarCotizacion}
          disabled={!puedeGuardar}
          className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
        >
          {guardando ? "Guardando..." : editandoId ? "Guardar cambios" : "Guardar cotización"}
        </button>
      </div>

      <div>
        <h2 className="mb-2 font-medium text-brand-green-700 dark:text-brand-vanilla">Cotizaciones guardadas</h2>
        {errorLista && <p className="mb-2 text-sm text-red-600">{errorLista}</p>}
        {errorImprimir && <p className="mb-2 text-sm text-red-600">{errorImprimir}</p>}
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Nº</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {cargandoLista ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                    Cargando...
                  </td>
                </tr>
              ) : cotizaciones.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                    Todavía no hay cotizaciones guardadas.
                  </td>
                </tr>
              ) : (
                cotizaciones.map((c) => (
                  <tr key={c.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">{c.numero}</td>
                    <td className="px-3 py-2">{c.cliente_nombre ?? "—"}</td>
                    <td className="px-3 py-2">{formatearFecha(c.created_at)}</td>
                    <td className="px-3 py-2">{formatMoney(c.total)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => empezarEdicion(c.id)}
                          disabled={cargandoEdicion === c.id}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          {cargandoEdicion === c.id ? "..." : "Editar"}
                        </button>
                        <button
                          onClick={() => imprimirCotizacion(c.id)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          Imprimir
                        </button>
                        <button
                          onClick={() => eliminarCotizacion(c.id)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {recibo && <ModalImprimir {...recibo} onCerrar={() => setRecibo(null)} />}
    </div>
  );
}
