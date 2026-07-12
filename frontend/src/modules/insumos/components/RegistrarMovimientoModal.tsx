import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { insumosApi, type Almacen, type Insumo, type RegistrarMovimientoInput } from "../api";

interface RegistrarMovimientoModalProps {
  insumos: Insumo[];
  almacenes: Almacen[];
  onCerrar: () => void;
  onRegistrado: () => Promise<void> | void;
}

export function RegistrarMovimientoModal({
  insumos,
  almacenes,
  onCerrar,
  onRegistrado,
}: RegistrarMovimientoModalProps) {
  const [insumoId, setInsumoId] = useState("");
  const [almacenId, setAlmacenId] = useState<number | "">("");
  const [tipo, setTipo] = useState<RegistrarMovimientoInput["tipo"]>("entrada");
  const [cantidad, setCantidad] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function registrar() {
    if (!insumoId || almacenId === "") {
      setError("Selecciona un insumo y un almacén");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await insumosApi.registrarMovimiento({ insumoId, almacenId: Number(almacenId), tipo, cantidad });
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titulo="Registrar movimiento" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Insumo</label>
      <select
        autoFocus
        value={insumoId}
        onChange={(e) => setInsumoId(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="" disabled>
          Selecciona un insumo
        </option>
        {insumos.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nombre}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs font-medium">Almacén</label>
      <select
        value={almacenId}
        onChange={(e) => setAlmacenId(Number(e.target.value))}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="" disabled>
          Selecciona un almacén
        </option>
        {almacenes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre}
          </option>
        ))}
      </select>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as RegistrarMovimientoInput["tipo"])}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
            <option value="ajuste">Ajuste</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Cantidad</label>
          <input
            type="number"
            min={0.01}
            step="0.01"
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={submitting}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Registrando..." : "Registrar movimiento"}
      </button>
    </Modal>
  );
}
