import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";

interface Producto {
  id: string;
  nombre: string;
  precio: number;
  descripcion?: string;
  imagen?: string;
  categoria?: string;
}

interface ItemCarrito {
  id: string;
  producto: Producto | null;
  descripcionOtro: string;
  cantidad: number;
  precioUnitario: number;
}

interface NuevaVentaModalProps {
  productos: Producto[];
  onCerrar: () => void;
  onGuardar: (venta: any) => Promise<void>;
}

export function NuevaVentaModal({ productos, onCerrar, onGuardar }: NuevaVentaModalProps) {
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productosFiltrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const total = carrito.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0);
  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;

  // Validar que todos los items sean válidos
  const itemsValidos = carrito.every((item) => {
    if (item.producto) {
      // Item con producto: solo validar que tenga precio
      return item.precioUnitario > 0;
    } else {
      // Item "Otro": debe tener descripción y precio
      return item.descripcionOtro.trim().length > 0 && item.precioUnitario > 0;
    }
  });

  const puedeRegistrar =
    carrito.length > 0 &&
    itemsValidos &&
    total > 0 &&
    (pago.metodoPago === "mixto" ? pago.montoEfectivo + pago.montoBanco > 0 : true) &&
    !mixtoInvalido;

  function agregarProducto(p: Producto) {
    setCarrito([
      ...carrito,
      {
        id: `${p.id}-${Date.now()}`,
        producto: p,
        descripcionOtro: "",
        cantidad: 1,
        precioUnitario: p.precio,
      },
    ]);
    setBusqueda("");
  }

  function agregarOtro() {
    setCarrito([
      ...carrito,
      {
        id: `otro-${Date.now()}`,
        producto: null,
        descripcionOtro: "",
        cantidad: 1,
        precioUnitario: 0,
      },
    ]);
    setBusqueda("");
  }

  function actualizarItem(id: string, updates: Partial<ItemCarrito>) {
    setCarrito(carrito.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }

  function eliminarItem(id: string) {
    setCarrito(carrito.filter((item) => item.id !== id));
  }

  async function guardar() {
    if (!puedeRegistrar) return;

    setRegistrando(true);
    setError(null);

    try {
      const venta = {
        id: Date.now(),
        items: carrito.map((item) => ({
          producto: item.producto?.nombre || item.descripcionOtro.trim(),
          descripcion: item.producto?.descripcion,
          imagen: item.producto?.imagen,
          categoria: item.producto?.categoria,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          subtotal: item.precioUnitario * item.cantidad,
        })),
        monto: total,
        metodoPago: pago.metodoPago,
        ...(pago.metodoPago === "mixto" && {
          montoEfectivo: pago.montoEfectivo,
          montoBanco: pago.montoBanco,
        }),
        fecha: new Date().toISOString(),
      };

      await onGuardar(venta);
      setCarrito([]);
      setBusqueda("");
      setPago({ metodoPago: "efectivo" });
      onCerrar();
    } catch (err) {
      setError("Error al registrar la venta");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo="Nueva venta" onCerrar={onCerrar} maxWidth="sm:max-w-2xl">
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Sección de agregar productos */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Buscar producto</label>
            <input
              autoFocus
              type="text"
              placeholder="Escribe para buscar..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>

          {busqueda && (
            <div className="max-h-48 overflow-y-auto rounded-md border border-brand-vanilla-dark bg-brand-vanilla dark:border-brand-green-700 dark:bg-brand-green-900">
              {productosFiltrados.length > 0 ? (
                <>
                  {productosFiltrados.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => agregarProducto(p)}
                      className="w-full border-b border-brand-vanilla-dark px-3 py-2 text-left text-sm text-brand-ink hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla dark:hover:bg-brand-green-700/50"
                    >
                      <div className="font-medium text-brand-green-700 dark:text-brand-vanilla">{p.nombre}</div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {p.categoria && <span>{p.categoria} · </span>}${p.precio.toLocaleString()}
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={agregarOtro}
                    className="w-full px-3 py-2 text-left text-sm font-semibold text-brand-green-700 hover:bg-brand-green-100 dark:text-brand-vanilla dark:hover:bg-brand-green-700/50"
                  >
                    + Otro producto
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={agregarOtro}
                  className="w-full border-t border-brand-vanilla-dark px-3 py-2 text-center text-sm font-semibold text-brand-green-700 dark:border-brand-green-700 dark:text-brand-vanilla"
                >
                  + Otro producto
                </button>
              )}
            </div>
          )}

          {!busqueda && (
            <button
              type="button"
              onClick={agregarOtro}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm font-medium text-brand-green-700 hover:border-brand-green-600 hover:bg-brand-green-100 dark:border-brand-green-700 dark:bg-brand-green-900/30 dark:text-brand-vanilla dark:hover:border-brand-green-500 dark:hover:bg-brand-green-700/40"
            >
              + Agregar producto
            </button>
          )}
        </div>

        {/* Carrito */}
        <div className="flex flex-col gap-3">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Carrito ({carrito.length})
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
            {carrito.length === 0 ? (
              <p className="text-center text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                Agrega productos al carrito
              </p>
            ) : (
              carrito.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 rounded-md bg-brand-green-50 p-2 dark:bg-brand-green-900/20"
                >
                  {item.producto ? (
                    <div className="flex items-start gap-2">
                      {item.producto.imagen && (
                        <img
                          src={item.producto.imagen}
                          alt={item.producto.nombre}
                          className="h-12 w-12 shrink-0 rounded object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                          {item.producto.nombre}
                        </div>
                        {item.producto.categoria && (
                          <div className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">
                            {item.producto.categoria}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        placeholder="Describe el producto..."
                        value={item.descripcionOtro}
                        onChange={(e) => actualizarItem(item.id, { descripcionOtro: e.target.value })}
                        className={`w-full rounded text-xs border bg-brand-vanilla px-2 py-1 text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla ${
                          item.descripcionOtro.trim().length === 0
                            ? "border-red-400 dark:border-red-500"
                            : "border-brand-vanilla-dark dark:border-brand-green-700"
                        }`}
                      />
                      {item.descripcionOtro.trim().length === 0 && (
                        <div className="mt-0.5 text-[10px] text-red-600 dark:text-red-400">
                          ⚠️ Campo requerido
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Cant.</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={item.cantidad || ""}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          actualizarItem(item.id, { cantidad: val === "" ? 1 : Math.max(1, Number(val)) });
                        }}
                        className="w-full rounded text-xs border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Precio</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={item.precioUnitario || ""}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          actualizarItem(item.id, { precioUnitario: val === "" ? 0 : Number(val) });
                        }}
                        className={`w-full rounded text-xs border bg-brand-vanilla px-2 py-1 text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla ${
                          item.precioUnitario <= 0
                            ? "border-red-400 dark:border-red-500"
                            : "border-brand-vanilla-dark dark:border-brand-green-700"
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Subtotal</label>
                      <div className="rounded bg-brand-green-100 px-2 py-1 text-xs font-semibold text-brand-green-700 dark:bg-brand-green-900/50 dark:text-brand-vanilla">
                        {formatMoney(item.precioUnitario * item.cantidad)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => eliminarItem(item.id)}
                      className="mt-5 text-xs text-red-600 hover:font-semibold dark:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Total */}
          <div className="rounded-lg bg-brand-green-50 p-3 dark:bg-brand-green-900/30">
            <div className="flex justify-between">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatMoney(total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Método de pago */}
      <div className="mt-4 border-t border-brand-vanilla-dark pt-4 dark:border-brand-green-700">
        <label className="mb-2 block text-xs font-medium">Método de pago</label>
        <SelectorMetodoPago value={pago} onChange={setPago} totalFijo={total} />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={registrando || !puedeRegistrar}
        className="mt-4 w-full rounded-md bg-brand-green-600 px-4 py-3 font-semibold text-white hover:bg-brand-green-700 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : `Registrar venta (${carrito.length} item${carrito.length !== 1 ? "s" : ""})`}
      </button>
    </Modal>
  );
}
