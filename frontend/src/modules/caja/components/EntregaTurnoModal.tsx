import { useState } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { entregaTurnoAReciboProps } from "../factura";
import type { ResumenTurno } from "../api";

interface EntregaTurnoModalProps {
  resumen: ResumenTurno;
  onCerrar: () => void;
}

/**
 * Acta de entrega de turno y caja: el turno sigue abierto, solo cambia
 * quién la maneja (ej. cambio de cajero a mitad del día). No guarda nada
 * ni calcula ningún total — es puramente un papel para imprimir, firmar y
 * escribir a mano el efectivo contado por cada persona. Disponible para
 * cualquiera que use Caja General, Cajero incluido.
 */
export function EntregaTurnoModal({ resumen, onCerrar }: EntregaTurnoModalProps) {
  const { usuario } = useAuth();
  const [recibidoPorNombre, setRecibidoPorNombre] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [imprimir, setImprimir] = useState(false);

  const entregadoPorNombre = usuario?.nombre ?? "";
  const puedeGenerar = recibidoPorNombre.trim().length > 0;

  if (imprimir) {
    return (
      <ModalImprimir
        {...entregaTurnoAReciboProps({
          turnoAbiertoEn: new Date(resumen.turno.abiertoEn).toLocaleString("es"),
          entregadoPorNombre,
          recibidoPorNombre: recibidoPorNombre.trim(),
          observaciones: observaciones.trim() || undefined,
        })}
        onCerrar={onCerrar}
      />
    );
  }

  return (
    <Modal titulo="📋 Entrega de turno y caja" onCerrar={onCerrar}>
      <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
        El turno sigue abierto, solo cambia quién maneja la caja. Esto no guarda ni calcula nada — genera un papel
        para firmar y escribir a mano el efectivo contado al entregar y al recibir.
      </p>

      <label className="mb-1 block text-xs font-medium">Entregado por</label>
      <input
        disabled
        value={entregadoPorNombre}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla-dark/10 px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900/40 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Recibido por</label>
      <input
        autoFocus
        value={recibidoPorNombre}
        onChange={(e) => setRecibidoPorNombre(e.target.value)}
        placeholder="Nombre de quien recibe la caja"
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Observaciones (opcional)</label>
      <textarea
        rows={2}
        value={observaciones}
        onChange={(e) => setObservaciones(e.target.value)}
        className="mb-3 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <button
        onClick={() => setImprimir(true)}
        disabled={!puedeGenerar}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        🖨️ Generar acta de entrega
      </button>
    </Modal>
  );
}
