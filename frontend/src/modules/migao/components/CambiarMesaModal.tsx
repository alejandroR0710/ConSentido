import { useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import type { Mesa, OrdenResumen } from "../api";
import { AREAS_MESA } from "../areas";
import { combinarMesasConOrdenes } from "../ocupacionMesas";
import { FloorPlanCanvas } from "./FloorPlanCanvas";

interface CambiarMesaModalProps {
  mesaActual: string | null;
  pisoActual: number | null;
  nombreActual: string | null;
  mesasLayout: Mesa[];
  ordenes: OrdenResumen[];
  onCerrar: () => void;
  onGuardar: (mesaNumero: string, piso: number, nombre: string) => Promise<void>;
}

/** Editar mesa + nombre de una orden ya abierta — ej. los comensales se
 *  cambiaron de mesa a mitad del pedido, o quieren identificar la cuenta con
 *  un nombre (ej. "Cumpleaños de Juan"). La mesa se resuelve/crea por número,
 *  igual que al crear la orden, así que no hace falta que ya exista. */
export function CambiarMesaModal({
  mesaActual,
  pisoActual,
  nombreActual,
  mesasLayout,
  ordenes,
  onCerrar,
  onGuardar,
}: CambiarMesaModalProps) {
  const [mesaNumero, setMesaNumero] = useState(mesaActual ?? "");
  const [piso, setPiso] = useState<1 | 2 | 3>(pisoActual === 2 ? 2 : pisoActual === 3 ? 3 : 1);
  const [nombre, setNombre] = useState(nombreActual ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!mesaNumero.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(mesaNumero.trim(), piso, nombre.trim());
      onCerrar();
    } catch {
      setError("No se pudo guardar la cuenta");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Editar cuenta" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Área</label>
      <div className="mb-4 flex gap-2">
        {AREAS_MESA.map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => setPiso(a.valor)}
            className={`flex-1 rounded-md border-2 px-2 py-2 text-sm font-medium transition ${
              piso === a.valor
                ? "border-brand-green-600 bg-brand-green-50 text-brand-green-700 dark:border-brand-green-500 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                : "border-brand-vanilla-dark text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/20"
            }`}
          >
            <span aria-hidden>{a.icon}</span> {a.label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <FloorPlanCanvas
          mesas={combinarMesasConOrdenes(
            mesasLayout.filter((m) => m.piso === piso && m.activo),
            ordenes,
          )}
          modo="seleccionar"
          onSeleccionar={(mesa) => setMesaNumero(mesa.numero)}
        />
      </div>

      <label className="mb-1 block text-xs font-medium">Número de mesa</label>
      <input
        autoFocus
        inputMode="numeric"
        value={mesaNumero}
        onChange={(e) => setMesaNumero(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        placeholder="Ej. 7"
      />

      <label className="mb-1 block text-xs font-medium">Nombre de la cuenta (opcional)</label>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        placeholder='Ej. "Cumpleaños de Juan"'
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={guardando || !mesaNumero.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>
    </Modal>
  );
}
