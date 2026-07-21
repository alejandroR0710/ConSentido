import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { migaoApi } from "../api";

interface NuevoInventarioProductoModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

/**
 * Alta de un producto de inventario "tal como lo entrega el proveedor" — ej.
 * una torta de chocolate (12 porciones), una paca de leche (6 unidades), o
 * una bolsita de amasijos suelta (unidades_por_paquete = 1). El stock arranca
 * en 0; se carga después con "Registrar movimiento" (entrada).
 */
export function NuevoInventarioProductoModal({ onCerrar, onCreado }: NuevoInventarioProductoModalProps) {
  const [nombre, setNombre] = useState("");
  const [unidadMedida, setUnidadMedida] = useState("");
  const [unidadesPorPaquete, setUnidadesPorPaquete] = useState(1);
  const [tamanoUnidad, setTamanoUnidad] = useState("");
  const [costoPaquete, setCostoPaquete] = useState(0);
  const [stockMinimoUnidades, setStockMinimoUnidades] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeGuardar = nombre.trim().length >= 2 && unidadMedida.trim().length > 0 && unidadesPorPaquete > 0;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.crearInventarioProducto({
        nombre: nombre.trim(),
        unidadMedida: unidadMedida.trim(),
        unidadesPorPaquete,
        tamanoUnidad: tamanoUnidad.trim() || undefined,
        costoPaquete: costoPaquete > 0 ? costoPaquete : undefined,
        stockMinimoUnidades: stockMinimoUnidades > 0 ? stockMinimoUnidades : undefined,
      });
      await onCreado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el producto");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo producto de inventario" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder='Ej. "Torta de chocolate"'
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Unidad de medida</label>
          <input
            value={unidadMedida}
            onChange={(e) => setUnidadMedida(e.target.value)}
            placeholder='"porción", "unidad", "bolsita"...'
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Unidades por paquete</label>
          <NumeroInput
            value={unidadesPorPaquete}
            onChange={setUnidadesPorPaquete}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>
      <p className="-mt-2 mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
        Ej. una torta de chocolate = 12 porciones; una paca de leche = 6 unidades; una bolsita suelta = 1.
      </p>

      <label className="mb-1 block text-xs font-medium">Tamaño/descripción de la unidad (opcional)</label>
      <input
        value={tamanoUnidad}
        onChange={(e) => setTamanoUnidad(e.target.value)}
        placeholder='Ej. "140g"'
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Costo por paquete (opcional)</label>
          <MoneyInput
            value={costoPaquete}
            onChange={setCostoPaquete}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Stock mínimo en unidades (opcional)</label>
          <NumeroInput
            value={stockMinimoUnidades}
            onChange={setStockMinimoUnidades}
            placeholder="0"
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !puedeGuardar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Creando..." : "Crear producto"}
      </button>
    </Modal>
  );
}
