import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";

interface CambiarMesaModalProps {
  mesaActual: string | null;
  pisoActual: number | null;
  onCerrar: () => void;
  onGuardar: (mesaNumero: string, piso: number) => Promise<void>;
}

/** Cambiar la mesa de una orden ya abierta — ej. los comensales se cambiaron
 *  de mesa a mitad del pedido. La mesa se resuelve/crea por número, igual que
 *  al crear la orden, así que no hace falta que ya exista. */
export function CambiarMesaModal({ mesaActual, pisoActual, onCerrar, onGuardar }: CambiarMesaModalProps) {
  const [mesaNumero, setMesaNumero] = useState(mesaActual ?? "");
  const [piso, setPiso] = useState<1 | 2>(pisoActual === 2 ? 2 : 1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!mesaNumero.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(mesaNumero.trim(), piso);
      onCerrar();
    } catch {
      setError("No se pudo cambiar la mesa");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Cambiar mesa" onCerrar={onCerrar}>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium">Número de mesa</label>
          <input
            autoFocus
            inputMode="numeric"
            value={mesaNumero}
            onChange={(e) => setMesaNumero(e.target.value)}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            placeholder="Ej. 7"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Salón</label>
          <select
            value={piso}
            onChange={(e) => setPiso(Number(e.target.value) as 1 | 2)}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !mesaNumero.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar mesa"}
      </button>
    </Modal>
  );
}
