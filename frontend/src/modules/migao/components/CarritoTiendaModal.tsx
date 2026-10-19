import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import { conSentidoApi, type ProductoConSentido } from "../../con_sentido/api";
import { migaoApi, type CarritoTienda } from "../api";

interface ItemCarrito {
  productoId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  stockDisponible: number | null;
  observacionInventario: string;
}

interface CarritoTiendaModalProps {
  parteId: string;
  carritoActual: CarritoTienda | null;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Carrito de productos Con Sentido vinculado a una parte de cuenta
 *  dividida de Migao — ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md.
 *  "Guardar carrito" reemplaza TODO el carrito de esa parte de una vez
 *  (mismo criterio que guardar la receta de ingredientes de un producto). */
export function CarritoTiendaModal({ parteId, carritoActual, onCerrar, onGuardado }: CarritoTiendaModalProps) {
  const [productos, setProductos] = useState<ProductoConSentido[]>([]);
  const [items, setItems] = useState<ItemCarrito[]>(
    (carritoActual?.items ?? [])
      .filter((i) => i.productoId)
      .map((i) => ({
        productoId: i.productoId!,
        nombre: i.nombre,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        stockDisponible: null,
        observacionInventario: "",
      })),
  );
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(carritoActual?.descuentoPorcentaje ?? 0);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    conSentidoApi.listarProductos().then(setProductos).catch(() => {});
  }, []);

  const termino = normalizar(busqueda.trim());
  const productosFiltrados = termino ? productos.filter((p) => normalizar(p.nombre).includes(termino)) : [];

  function agregarProducto(producto: ProductoConSentido) {
    setItems((prev) => {
      const existente = prev.find((i) => i.productoId === producto.id);
      if (existente) {
        return prev.map((i) => (i.productoId === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [
        ...prev,
        {
          productoId: producto.id,
          nombre: producto.nombre,
          cantidad: 1,
          precioUnitario: producto.precio,
          stockDisponible: producto.stock,
          observacionInventario: "",
        },
      ];
    });
    setBusqueda("");
  }

  function quitarItem(productoId: string) {
    setItems((prev) => prev.filter((i) => i.productoId !== productoId));
  }

  function cambiarCantidad(productoId: string, cantidad: number) {
    setItems((prev) => prev.map((i) => (i.productoId === productoId ? { ...i, cantidad } : i)));
  }

  function cambiarObservacion(productoId: string, observacionInventario: string) {
    setItems((prev) => prev.map((i) => (i.productoId === productoId ? { ...i, observacionInventario } : i)));
  }

  // Sin stock suficiente se vende igual (decisión del negocio), pero exige
  // explicar por qué no cuadra — mismo criterio que la venta normal de Con
  // Sentido (hallazgo I10 de la revisión final).
  function faltaStock(item: ItemCarrito) {
    return item.stockDisponible !== null && item.cantidad > item.stockDisponible;
  }
  const faltaAlgunaObservacion = items.some((i) => faltaStock(i) && i.observacionInventario.trim().length === 0);

  const subtotal = items.reduce((acc, i) => acc + i.cantidad * i.precioUnitario, 0);
  const descuentoMonto = Math.round(subtotal * (descuentoPorcentaje / 100));
  const total = subtotal - descuentoMonto;

  async function guardar() {
    if (items.length === 0 || faltaAlgunaObservacion) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.vincularCarritoTienda(parteId, {
        items: items.map((i) => ({
          productoId: i.productoId,
          cantidad: i.cantidad,
          precioUnitario: i.precioUnitario,
          observacionInventario: faltaStock(i) ? i.observacionInventario.trim() : undefined,
        })),
        descuentoPorcentaje: descuentoPorcentaje || undefined,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el carrito de tienda");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Productos de la tienda" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <label className="mb-1 block text-xs font-medium">Buscar producto</label>
      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Nombre del producto..."
        className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />
      {productosFiltrados.length > 0 && (
        <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          {productosFiltrados.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => agregarProducto(p)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-green-50 dark:hover:bg-brand-green-700/40"
            >
              <span>{p.nombre}</span>
              <span className="text-brand-ink/60 dark:text-brand-vanilla/60">{formatMoney(p.precio)}</span>
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="mb-3 text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
          Sin productos agregados.
        </p>
      ) : (
        <div className="mb-3 flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.productoId} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="flex-1">{item.nombre}</span>
                <input
                  type="number"
                  min={1}
                  value={item.cantidad}
                  onChange={(e) => cambiarCantidad(item.productoId, Math.max(1, Number(e.target.value)))}
                  className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-center text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <span className="w-20 text-right">{formatMoney(item.cantidad * item.precioUnitario)}</span>
                <button
                  type="button"
                  onClick={() => quitarItem(item.productoId)}
                  className="text-red-600 hover:underline"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
              {faltaStock(item) && (
                <input
                  value={item.observacionInventario}
                  onChange={(e) => cambiarObservacion(item.productoId, e.target.value)}
                  placeholder={`Sin stock suficiente (quedan ${item.stockDisponible}) — explica por qué no cuadra el inventario`}
                  className="w-full rounded-md border border-amber-400 bg-brand-vanilla px-2 py-1 text-xs text-brand-ink outline-none dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <label className="mb-1 block text-xs font-medium">Descuento (%)</label>
      <input
        type="number"
        min={0}
        max={100}
        value={descuentoPorcentaje}
        onChange={(e) => setDescuentoPorcentaje(Math.min(100, Math.max(0, Number(e.target.value))))}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
      />

      <div className="mb-4 flex justify-between text-sm font-semibold">
        <span>Total tienda</span>
        <span>{formatMoney(total)}</span>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || items.length === 0 || faltaAlgunaObservacion}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar carrito"}
      </button>
    </Modal>
  );
}
