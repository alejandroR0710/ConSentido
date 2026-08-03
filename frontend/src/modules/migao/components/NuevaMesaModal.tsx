import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";

interface NuevaMesaModalProps {
  onCerrar: () => void;
  onGuardar: (numero: string, capacidad: number) => Promise<void>;
}

/** Crea una mesa con un rectángulo por defecto en el área activa — Root la
 *  arrastra a su lugar y la redimensiona después, directo en el plano. */
export function NuevaMesaModal({ onCerrar, onGuardar }: NuevaMesaModalProps) {
  const [numero, setNumero] = useState("");
  const [capacidad, setCapacidad] = useState("4");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!numero.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(numero.trim(), Number(capacidad) || 4);
      onCerrar();
    } catch {
      setError("No se pudo crear la mesa");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva mesa" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Número de mesa</label>
      <input
        autoFocus
        inputMode="numeric"
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        placeholder="Ej. 7"
      />

      <label className="mb-1 block text-xs font-medium">Capacidad (comensales)</label>
      <input
        inputMode="numeric"
        value={capacidad}
        onChange={(e) => setCapacidad(e.target.value.replace(/\D/g, ""))}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !numero.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Creando..." : "Crear mesa"}
      </button>
    </Modal>
  );
}
