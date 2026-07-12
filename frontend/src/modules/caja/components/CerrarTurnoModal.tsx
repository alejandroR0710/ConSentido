import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi } from "../api";

interface CerrarTurnoModalProps {
  turnoId: string;
  onCerrar: () => void;
  onCerrado: (mensaje: string) => Promise<void>;
}

export function CerrarTurnoModal({ turnoId, onCerrar, onCerrado }: CerrarTurnoModalProps) {
  const [montoDeclarado, setMontoDeclarado] = useState(0);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setCerrando(true);
    setError(null);
    try {
      const turnoCerrado = await cajaApi.cerrarTurno(turnoId, montoDeclarado);
      const diferencia = Number(turnoCerrado.diferenciaEfectivo ?? 0);
      const mensaje =
        diferencia === 0
          ? "Turno cerrado. El efectivo cuadra exacto."
          : `Turno cerrado. Diferencia en efectivo: ${diferencia > 0 ? "sobran" : "faltan"} ${formatMoney(Math.abs(diferencia))}.`;
      await onCerrado(mensaje);
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar el turno");
    } finally {
      setCerrando(false);
    }
  }

  return (
    <Modal titulo="Cerrar turno" onCerrar={onCerrar}>
      <p className="mb-3 text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        Cuenta el efectivo físico de la caja y escribe el total. Banco no requiere conteo.
      </p>
      <label className="mb-1 block text-xs font-medium">Efectivo contado</label>
      <MoneyInput
        autoFocus
        value={montoDeclarado}
        onChange={setMontoDeclarado}
        className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-3 text-lg text-brand-ink outline-none focus:border-red-400 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={confirmar}
        disabled={cerrando}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {cerrando ? "Cerrando..." : "Confirmar cierre"}
      </button>
    </Modal>
  );
}
