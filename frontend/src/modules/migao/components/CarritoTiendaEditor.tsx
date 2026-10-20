import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { SugerenciasProducto } from "../../caja/components/SugerenciasProducto";
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

interface CarritoTiendaEditorProps {
  parteId: string;
  carritoActual: CarritoTienda | null;
  // Recarga la cuenta Y cierra el editor (vuelve al resumen de solo
  // lectura) — las dos cosas las decide quien nos renderiza (MigaoPage).
  onGuardado: () => Promise<void> | void;
  onCancelar: () => void;
}

/** Editor del carrito de productos Con Sentido vinculado a una parte de
 *  cuenta dividida de Migao — vive en el panel lateral, al costado del
 *  diálogo de la mesa (nunca como un popup aparte encima): el cajero tiene
 *  que poder ver la cuenta de la mesa mientras arma el carrito de tienda.
 *  "Guardar carrito" reemplaza TODO el carrito de esa parte de una vez
 *  (mismo criterio que guardar la receta de ingredientes de un producto). */
export function CarritoTiendaEditor({ parteId, carritoActual, onGuardado, onCancelar }: CarritoTiendaEditorProps) {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el carrito de tienda");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col gap-3 rounded-xl border border-brand-vanilla-dark bg-brand-vanilla-dark p-3 dark:border-brand-green-600 dark:bg-brand-green-700">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
          Productos de la tienda
        </h4>
        <button
          type="button"
          onClick={onCancelar}
          aria-label="Cancelar"
          className="text-xs font-medium text-brand-ink/60 hover:underline dark:text-brand-vanilla/60"
        >
          ✕ Cancelar
        </button>
      </div>

      <div className="relative">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre o SKU del producto..."
          className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-900 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
        <SugerenciasProducto productos={productos} texto={busqueda} onSeleccionar={agregarProducto} />
      </div>

      {items.length === 0 ? (
        <p className="text-center text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Sin productos agregados.</p>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <div key={item.productoId} className="flex flex-col gap-1 rounded-lg bg-brand-vanilla px-2 py-1.5 dark:bg-brand-green-900">
              <div className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate">{item.nombre}</span>
                <input
                  type="number"
                  min={1}
                  value={item.cantidad}
                  onChange={(e) => cambiarCantidad(item.productoId, Math.max(1, Number(e.target.value)))}
                  className="w-12 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-1 py-0.5 text-center text-xs dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <span className="w-16 shrink-0 text-right">{formatMoney(item.cantidad * item.precioUnitario)}</span>
                <button type="button" onClick={() => quitarItem(item.productoId)} className="text-red-600 hover:underline" aria-label="Quitar">
                  ✕
                </button>
              </div>
              {faltaStock(item) && (
                <input
                  value={item.observacionInventario}
                  onChange={(e) => cambiarObservacion(item.productoId, e.target.value)}
                  placeholder={`Sin stock suficiente (quedan ${item.stockDisponible}) — explica por qué`}
                  className="w-full rounded-md border border-amber-400 bg-brand-vanilla px-2 py-1 text-[11px] text-brand-ink outline-none dark:bg-brand-green-900 dark:text-brand-vanilla"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <label className="-mb-1.5 block text-[11px] font-medium">Descuento (%)</label>
      <input
        type="number"
        min={0}
        max={100}
        value={descuentoPorcentaje}
        onChange={(e) => setDescuentoPorcentaje(Math.min(100, Math.max(0, Number(e.target.value))))}
        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
      />

      <div className="flex justify-between text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
        <span>Total tienda</span>
        <span>{formatMoney(total)}</span>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || items.length === 0 || faltaAlgunaObservacion}
        className="mt-auto w-full rounded-md bg-brand-green-700 px-4 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar carrito"}
      </button>
    </div>
  );
}
