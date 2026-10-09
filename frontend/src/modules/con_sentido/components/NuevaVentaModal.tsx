import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import {
  SelectorMetodoPago,
  faltaReferenciaBanco,
  referenciaBancoPayload,
  type MetodoPagoValor,
} from "../../../shared/components/SelectorMetodoPago";
import { formatMoney } from "../../../shared/format/money";
import { preciosConMayorista, textoMayorista } from "../mayorista";

interface Producto {
  id: string;
  nombre: string;
  precio: number;
  descripcion?: string;
  imagen?: string;
  imagen_url?: string | null;
  categoria?: string;
  sku?: string | null;
  stock?: number;
  ecommerce_publicado?: boolean | null;
  // Mayorista (llega del e-commerce): ver ../mayorista.ts.
  grupo?: string;
  precio_mayorista?: number | null;
  mayorista_desde?: number | null;
}

// Normaliza para buscar sin importar mayúsculas ni tildes ("fragancia" encuentra "Fragáncia").
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

interface ItemCarrito {
  id: string;
  producto: Producto | null;
  descripcionOtro: string;
  cantidad: number;
  precioUnitario: number;
  // El cajero cambió el precio a mano: el mayorista automático ya no lo toca.
  precioManual: boolean;
  // Obligatoria si la venta deja el producto en stock negativo (ver faltaStock).
  observacionInventario: string;
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

  // Por nombre o por SKU.
  const termino = normalizar(busqueda.trim());
  const productosFiltrados = productos.filter(
    (p) => normalizar(p.nombre).includes(termino) || (p.sku ? normalizar(p.sku).includes(termino) : false),
  );

  // Cuánto se está llevando de cada producto en todo el carrito (puede estar en varias líneas).
  const cantidadEnCarrito = (productoId: string) =>
    carrito.filter((i) => i.producto?.id === productoId).reduce((sum, i) => sum + i.cantidad, 0);

  // Sin stock suficiente se vende igual: el inventario queda en negativo y hay
  // que explicar por qué no cuadró (apareció en bodega, mala contada...).
  const stockResultante = (item: ItemCarrito) =>
    item.producto && item.producto.stock !== undefined
      ? Number(item.producto.stock) - cantidadEnCarrito(item.producto.id)
      : null;
  const faltaStock = (item: ItemCarrito) => {
    const resultante = stockResultante(item);
    return resultante !== null && resultante < 0;
  };

  // Precio mayorista: se recalcula con cada cambio del carrito (sumando las líneas del mismo
  // producto). `precioDe` es el precio que de verdad se cobra en cada línea.
  const precios = preciosConMayorista(
    carrito.map((item) => ({
      grupo: item.producto ? (item.producto.grupo ?? item.producto.id) : null,
      cantidad: item.cantidad,
      precioNormal: item.producto ? Number(item.producto.precio) : item.precioUnitario,
      precioMayorista: item.producto?.precio_mayorista ?? null,
      mayoristaDesde: item.producto?.mayorista_desde ?? null,
      precioManual: item.precioManual,
    })),
  );
  const precioDe = (item: ItemCarrito) => precios[carrito.indexOf(item)]?.precio ?? item.precioUnitario;
  const esMayorista = (item: ItemCarrito) => precios[carrito.indexOf(item)]?.esMayorista ?? false;

  const total = carrito.reduce((sum, item) => sum + precioDe(item) * item.cantidad, 0);
  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;

  // Validar que todos los items sean válidos
  const itemsValidos = carrito.every((item) => {
    if (item.producto) {
      // Item con producto: precio, y observación si queda en stock negativo
      return precioDe(item) > 0 && (!faltaStock(item) || item.observacionInventario.trim().length > 0);
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
    !mixtoInvalido &&
    !faltaReferenciaBanco(pago);

  function agregarProducto(p: Producto) {
    setCarrito([
      ...carrito,
      {
        id: `${p.id}-${Date.now()}`,
        producto: p,
        descripcionOtro: "",
        cantidad: 1,
        precioUnitario: Number(p.precio),
        precioManual: false,
        observacionInventario: "",
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
        precioManual: false,
        observacionInventario: "",
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
          productoId: item.producto?.id,
          producto: item.producto?.nombre || item.descripcionOtro.trim(),
          descripcion: item.producto?.descripcion,
          imagen: item.producto?.imagen ?? item.producto?.imagen_url ?? undefined,
          categoria: item.producto?.categoria,
          cantidad: item.cantidad,
          precioUnitario: precioDe(item),
          subtotal: precioDe(item) * item.cantidad,
          observacionInventario: faltaStock(item) ? item.observacionInventario.trim() : undefined,
        })),
        monto: total,
        metodoPago: pago.metodoPago,
        ...(pago.metodoPago === "mixto" && {
          montoEfectivo: pago.montoEfectivo,
          montoBanco: pago.montoBanco,
        }),
        ...referenciaBancoPayload(pago),
        fecha: new Date().toISOString(),
      };

      await onGuardar(venta);
      setCarrito([]);
      setBusqueda("");
      setPago({ metodoPago: "efectivo" });
      onCerrar();
    } catch (err) {
      // El motivo real (caja cerrada, producto que ya no existe...) viene del servidor.
      setError(err instanceof ApiError ? err.message : "Error al registrar la venta");
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
              placeholder="Nombre o SKU..."
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
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-brand-green-700 dark:text-brand-vanilla">{p.nombre}</span>
                        {p.ecommerce_publicado === false && (
                          <span className="rounded bg-brand-vanilla-dark px-1.5 py-0.5 text-[10px] text-brand-ink/70 dark:bg-brand-green-700 dark:text-brand-vanilla/70">
                            No publicado
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {p.sku && <span className="font-mono">{p.sku} · </span>}
                        {p.categoria && <span>{p.categoria} · </span>}
                        {formatMoney(Number(p.precio))}
                        {p.stock !== undefined && (
                          <span className={Number(p.stock) <= 0 ? " font-semibold text-red-600 dark:text-red-400" : ""}>
                            {" · "}
                            {Number(p.stock) === 0 ? "Sin stock" : `Stock: ${Number(p.stock)}`}
                            {textoMayorista({ precio_mayorista: p.precio_mayorista ?? null, mayorista_desde: p.mayorista_desde ?? null }) && (
                              <span className="text-brand-green-700 dark:text-brand-vanilla">
                                {" · "}
                                {textoMayorista({ precio_mayorista: p.precio_mayorista ?? null, mayorista_desde: p.mayorista_desde ?? null })}
                              </span>
                            )}
                          </span>
                        )}
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
                        {(item.producto.sku || item.producto.categoria) && (
                          <div className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">
                            {item.producto.sku && <span className="font-mono">{item.producto.sku}</span>}
                            {item.producto.sku && item.producto.categoria && " · "}
                            {item.producto.categoria}
                          </div>
                        )}
                        {faltaStock(item) && (
                          <div className="mt-1">
                            <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              ⚠️ En inventario hay {Number(item.producto.stock)}: quedará en {stockResultante(item)}.
                              Explica por qué no cuadra el inventario:
                            </div>
                            <textarea
                              rows={2}
                              maxLength={500}
                              placeholder="Ej.: apareció en bodega, se hizo para esta venta, mala contada…"
                              value={item.observacionInventario}
                              onChange={(e) => actualizarItem(item.id, { observacionInventario: e.target.value })}
                              className={`mt-0.5 w-full rounded border bg-brand-vanilla px-2 py-1 text-xs text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla ${
                                item.observacionInventario.trim().length === 0
                                  ? "border-red-400 dark:border-red-500"
                                  : "border-brand-vanilla-dark dark:border-brand-green-700"
                              }`}
                            />
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
                      <label className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">
                        Precio
                        {esMayorista(item) && (
                          <span className="ml-1 font-semibold text-brand-green-700 dark:text-brand-vanilla">· Mayorista</span>
                        )}
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={precioDe(item) || ""}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "");
                          actualizarItem(item.id, { precioUnitario: val === "" ? 0 : Number(val), precioManual: true });
                        }}
                        className={`w-full rounded text-xs border bg-brand-vanilla px-2 py-1 text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla ${
                          precioDe(item) <= 0
                            ? "border-red-400 dark:border-red-500"
                            : "border-brand-vanilla-dark dark:border-brand-green-700"
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-brand-ink/60 dark:text-brand-vanilla/60">Subtotal</label>
                      <div className="rounded bg-brand-green-100 px-2 py-1 text-xs font-semibold text-brand-green-700 dark:bg-brand-green-900/50 dark:text-brand-vanilla">
                        {formatMoney(precioDe(item) * item.cantidad)}
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
