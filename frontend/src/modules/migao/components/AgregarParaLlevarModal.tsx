import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { migaoApi, type Producto } from "../api";

interface AgregarParaLlevarModalProps {
  ordenId: string;
  onCerrar: () => void;
  onAgregado: () => Promise<void>;
}

/** Cargo de "para llevar" (ej. envases) que el Cajero puede agregar a la
 *  cuenta al cobrar — solo ofrece los productos marcados como tal (ver
 *  migaoApi.listarProductosParaLlevar / agregarCargoParaLlevar). El precio
 *  viene prellenado con el del catálogo pero se puede corregir, por si el
 *  monto varía (ej. según el tamaño del envase). */
export function AgregarParaLlevarModal({ ordenId, onCerrar, onAgregado }: AgregarParaLlevarModalProps) {
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [productoId, setProductoId] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [precio, setPrecio] = useState(0);
  const [nota, setNota] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migaoApi
      .listarProductosParaLlevar()
      .then((lista) => {
        setProductos(lista);
        if (lista.length > 0) {
          setProductoId(lista[0].id);
          setPrecio(Number(lista[0].precio));
        }
      })
      .catch(() => setProductos([]));
  }, []);

  function seleccionarProducto(id: string) {
    setProductoId(id);
    const producto = productos?.find((p) => p.id === id);
    if (producto) setPrecio(Number(producto.precio));
  }

  async function agregar() {
    if (!productoId || cantidad <= 0) return;
    setCargando(true);
    setError(null);
    try {
      await migaoApi.agregarCargoParaLlevar(ordenId, productoId, cantidad, precio, nota.trim() || undefined);
      await onAgregado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo agregar el cargo");
    } finally {
      setCargando(false);
    }
  }

  return (
    <Modal titulo="🥡 Para llevar" onCerrar={onCerrar}>
      {productos === null ? (
        <p className="text-sm text-brand-ink/60">Cargando...</p>
      ) : productos.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
          Todavía no hay productos marcados como "para llevar". Pide al Administrador que cree uno en el Menú (ej.
          "Envase para llevar").
        </p>
      ) : (
        <>
          {productos.length > 1 && (
            <>
              <label className="mb-1 block text-xs font-medium">Producto</label>
              <select
                autoFocus
                value={productoId}
                onChange={(e) => seleccionarProducto(e.target.value)}
                className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              >
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="mb-1 block text-xs font-medium">Cantidad</label>
          <input
            type="number"
            min={1}
            step="1"
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          <label className="mb-1 block text-xs font-medium">Precio (puedes corregirlo)</label>
          <MoneyInput
            value={precio}
            onChange={setPrecio}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          <label className="mb-1 block text-xs font-medium">Nota (opcional)</label>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej. 3 envases"
            className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          <button
            onClick={agregar}
            disabled={cargando || cantidad <= 0}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {cargando ? "Agregando..." : "Agregar cargo"}
          </button>
        </>
      )}
    </Modal>
  );
}
