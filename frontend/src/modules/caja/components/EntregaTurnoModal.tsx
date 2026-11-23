import { useEffect, useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { cajaApi, type ResumenTurno } from "../api";
import { entregaTurnoAReciboProps } from "../factura";

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
 *
 * "Entregado por"/"Recibido por" son selects (no texto libre ni el usuario
 * logueado): la cuenta "Cajero" la comparten varias personas reales, así
 * que no hay forma de saber quién es quién a partir de la sesión — se
 * elige entre las personas con ese mismo perfil (ver caja.repository.ts::listCajeros).
 */
export function EntregaTurnoModal({ resumen, onCerrar }: EntregaTurnoModalProps) {
  const [cajeros, setCajeros] = useState<{ id: string; nombre: string }[]>([]);
  const [entregadoPorId, setEntregadoPorId] = useState("");
  const [recibidoPorId, setRecibidoPorId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [imprimir, setImprimir] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cajaApi
      .listarCajeros()
      .then(setCajeros)
      .catch(() => setError("No se pudo cargar la lista de cajeros"));
  }, []);

  const puedeGenerar = Boolean(entregadoPorId) && Boolean(recibidoPorId) && entregadoPorId !== recibidoPorId;

  if (imprimir) {
    return (
      <ModalImprimir
        {...entregaTurnoAReciboProps({
          turnoAbiertoEn: new Date(resumen.turno.abiertoEn).toLocaleString("es"),
          entregadoPorNombre: cajeros.find((c) => c.id === entregadoPorId)?.nombre ?? "",
          recibidoPorNombre: cajeros.find((c) => c.id === recibidoPorId)?.nombre ?? "",
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

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <label className="mb-1 block text-xs font-medium">Entregado por</label>
      <select
        autoFocus
        value={entregadoPorId}
        onChange={(e) => setEntregadoPorId(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="" disabled>
          Selecciona quién entrega
        </option>
        {cajeros.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs font-medium">Recibido por</label>
      <select
        value={recibidoPorId}
        onChange={(e) => setRecibidoPorId(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="" disabled>
          Selecciona quién recibe
        </option>
        {cajeros.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {entregadoPorId && entregadoPorId === recibidoPorId && (
        <p className="mb-3 text-xs text-red-600">Quien entrega y quien recibe no pueden ser la misma persona.</p>
      )}

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
