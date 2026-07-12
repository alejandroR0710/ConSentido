import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { insumosApi } from "../api";

interface NuevoInsumoModalProps {
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
}

export function NuevoInsumoModal({ onCerrar, onCreado }: NuevoInsumoModalProps) {
  const [nombre, setNombre] = useState("");
  const [unidadMedida, setUnidadMedida] = useState("unidad");
  const [stockMinimo, setStockMinimo] = useState(0);
  const [costoUnitario, setCostoUnitario] = useState(0);
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function crear() {
    if (!nombre.trim() || !unidadMedida.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await insumosApi.crear({
        nombre: nombre.trim(),
        unidadMedida: unidadMedida.trim(),
        stockMinimo,
        costoUnitario,
        descripcion: descripcion.trim() || undefined,
      });
      await onCreado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el insumo");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titulo="Nuevo insumo" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Unidad de medida</label>
      <input
        value={unidadMedida}
        onChange={(e) => setUnidadMedida(e.target.value)}
        placeholder="kg, lt, unidad..."
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Stock mínimo</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={stockMinimo}
            onChange={(e) => setStockMinimo(Number(e.target.value))}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Costo unitario</label>
          <MoneyInput
            value={costoUnitario}
            onChange={setCostoUnitario}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Descripción (opcional)</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={3}
        className="mb-4 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={crear}
        disabled={submitting || !nombre.trim() || !unidadMedida.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Guardando..." : "Crear insumo"}
      </button>
    </Modal>
  );
}
