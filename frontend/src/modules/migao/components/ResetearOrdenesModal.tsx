import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi } from "../api";

const FRASE_CONFIRMACION = "REINICIAR ORDENES";

interface ResetearOrdenesModalProps {
  onCerrar: () => void;
  onReseteado: (mensaje: string) => Promise<void> | void;
}

/** Reset exclusivo de Super Root: a diferencia del reset de Caja, este SÍ borra
 *  por completo el historial (no hay pantalla de reportes de órdenes que
 *  conservar) — órdenes, ítems, historial, ventas y pagos ligados a ellas. */
export function ResetearOrdenesModal({ onCerrar, onReseteado }: ResetearOrdenesModalProps) {
  const [frase, setFrase] = useState("");
  const [reseteando, setReseteando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (frase !== FRASE_CONFIRMACION) return;
    setReseteando(true);
    setError(null);
    try {
      const resultado = await migaoApi.resetearOrdenes();
      await onReseteado(
        `Historial de órdenes borrado: ${resultado.ordenesBorradas} orden(es), ${resultado.ventasBorradas} venta(s), ${resultado.movimientosCajaBorrados} movimiento(s) de Caja (incluye ingresos manuales de Migao).`,
      );
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reiniciar el historial de órdenes");
    } finally {
      setReseteando(false);
    }
  }

  return (
    <Modal titulo="Reiniciar historial de órdenes" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto borra <strong>por completo</strong> todas las órdenes (abiertas, cerradas y canceladas), sus productos,
        su historial, las ventas/pagos ya cobrados que quedaron ligados a ellas, y los ingresos manuales de Migao que
        Caja haya registrado a mano (los que aparecen en el historial de pedidos sin venir de una orden).
      </p>
      <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        A diferencia del reset de Caja, esto <strong>no se puede deshacer</strong> ni conserva nada para consultar
        después.
      </p>

      <label className="mb-1 block text-xs font-medium">
        Escribe <span className="font-mono">{FRASE_CONFIRMACION}</span> para confirmar
      </label>
      <input
        autoFocus
        value={frase}
        onChange={(e) => setFrase(e.target.value)}
        placeholder={FRASE_CONFIRMACION}
        className="mb-4 w-full rounded-md border border-red-300 bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-red-500 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={confirmar}
        disabled={reseteando || frase !== FRASE_CONFIRMACION}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {reseteando ? "Borrando..." : "Borrar historial de órdenes"}
      </button>
    </Modal>
  );
}
