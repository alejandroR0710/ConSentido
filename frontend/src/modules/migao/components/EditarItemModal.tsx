import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import type { OrdenItem } from "../api";
import { formatCantidad } from "../format";

interface EditarItemModalProps {
  item: OrdenItem;
  onCerrar: () => void;
  onGuardar: (cantidad: number) => Promise<void>;
  onCancelarProducto: () => Promise<void>;
}

/** Popup de edición: cambiar cantidad o cancelar el producto, sin ensuciar la
 *  lista de ítems con un input+botón permanente en cada fila. */
export function EditarItemModal({ item, onCerrar, onGuardar, onCancelarProducto }: EditarItemModalProps) {
  const [cantidad, setCantidad] = useState(formatCantidad(item.cantidad));
  const [guardando, setGuardando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  async function guardar() {
    const valor = Number(cantidad);
    if (!valor || valor <= 0) return;
    setGuardando(true);
    try {
      await onGuardar(valor);
      onCerrar();
    } finally {
      setGuardando(false);
    }
  }

  async function cancelarProducto() {
    setCancelando(true);
    try {
      await onCancelarProducto();
      onCerrar();
    } finally {
      setCancelando(false);
    }
  }

  return (
    <Modal titulo={item.producto_nombre} onCerrar={onCerrar}>
      {item.observaciones && (
        <p className="mb-3 text-sm font-semibold text-amber-700 dark:text-amber-400">⚠ {item.observaciones}</p>
      )}

      <label className="mb-1 block text-xs font-medium">Cantidad</label>
      <input
        type="number"
        min={0.01}
        step="0.01"
        autoFocus
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-3 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <button
        onClick={guardar}
        disabled={guardando || cancelando}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambio"}
      </button>
      <button
        onClick={cancelarProducto}
        disabled={guardando || cancelando}
        className="w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {cancelando ? "Cancelando..." : "Cancelar producto"}
      </button>
    </Modal>
  );
}
