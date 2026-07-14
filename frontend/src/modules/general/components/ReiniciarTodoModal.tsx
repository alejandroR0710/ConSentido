import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi } from "../../migao/api";

const FRASE_CONFIRMACION = "REINICIAR TODO";

interface ReiniciarTodoModalProps {
  onCerrar: () => void;
  onReiniciado: (mensaje: string) => Promise<void> | void;
}

/** Reinicio total exclusivo de Super Root: borra por completo el historial
 *  transaccional de Migao y Caja (órdenes, ventas, pagos, turnos y
 *  movimientos de caja de cualquier módulo) — deja el negocio como recién
 *  instalado. Solo se conserva el catálogo (productos/categorías), usuarios
 *  y roles/permisos. Distinto y más amplio que "Reiniciar Caja" o "Reiniciar
 *  historial de órdenes", que siguen existiendo aparte para reinicios puntuales. */
export function ReiniciarTodoModal({ onCerrar, onReiniciado }: ReiniciarTodoModalProps) {
  const [frase, setFrase] = useState("");
  const [reiniciando, setReiniciando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (frase !== FRASE_CONFIRMACION) return;
    setReiniciando(true);
    setError(null);
    try {
      const resultado = await migaoApi.reiniciarTodo();
      await onReiniciado(
        `Reinicio total: ${resultado.ordenesBorradas} orden(es), ${resultado.ventasBorradas} venta(s), ` +
          `${resultado.pagosBorrados} pago(s), ${resultado.movimientosCajaBorrados} movimiento(s) de caja y ` +
          `${resultado.turnosBorrados} turno(s) borrados.`,
      );
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reiniciar el sistema");
    } finally {
      setReiniciando(false);
    }
  }

  return (
    <Modal titulo="Reiniciar todo" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
        Esto borra <strong>por completo</strong> todas las órdenes, ventas, pagos, turnos de caja y movimientos de
        caja de cualquier módulo — deja el negocio como recién instalado.
      </p>
      <p className="mb-3 rounded-md bg-brand-green-50 px-3 py-2 text-xs text-brand-green-700 dark:bg-brand-green-700/20 dark:text-brand-vanilla">
        Lo único que se conserva: el menú (productos y categorías), los usuarios y los roles/permisos.
      </p>
      <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
        No se puede deshacer. No hay copia de seguridad.
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
        disabled={reiniciando || frase !== FRASE_CONFIRMACION}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {reiniciando ? "Reiniciando..." : "Reiniciar todo"}
      </button>
    </Modal>
  );
}
