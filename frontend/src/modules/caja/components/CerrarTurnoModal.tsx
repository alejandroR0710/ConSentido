import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { cajaApi, type ResumenTurno } from "../api";
import { LABEL_POR_MODULO_SLUG } from "../moduloOrigen";

interface CerrarTurnoModalProps {
  resumen: ResumenTurno;
  onCerrar: () => void;
  onCerrado: (mensaje: string) => Promise<void>;
}

export function CerrarTurnoModal({ resumen, onCerrar, onCerrado }: CerrarTurnoModalProps) {
  const [montoDeclarado, setMontoDeclarado] = useState(0);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalIngresos = resumen.ingresosEfectivo + resumen.ingresosBanco;
  const totalEgresos = resumen.egresosEfectivo + resumen.egresosBanco;
  const baseInicial = Number(resumen.turno.montoInicialEfectivo) + Number(resumen.turno.montoInicialBanco);

  async function confirmar() {
    setCerrando(true);
    setError(null);
    try {
      const turnoCerrado = await cajaApi.cerrarTurno(resumen.turno.id, montoDeclarado);
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
      <div className="mb-4 flex flex-col gap-1 rounded-lg border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
        <div className="flex items-center justify-between">
          <span className="text-brand-ink/70 dark:text-brand-vanilla/70">
            Base inicial (efectivo {formatMoney(resumen.turno.montoInicialEfectivo)} + banco{" "}
            {formatMoney(resumen.turno.montoInicialBanco)})
          </span>
          <span className="font-medium text-brand-ink dark:text-brand-vanilla">{formatMoney(baseInicial)}</span>
        </div>

        <div className="my-1 border-t border-brand-vanilla-dark pt-1 dark:border-brand-green-700">
          <span className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Ingresos por área
          </span>
        </div>
        {resumen.ingresosPorArea.map((area) => (
          <div key={area.slug} className="flex items-center justify-between pl-2">
            <span className="text-brand-ink/70 dark:text-brand-vanilla/70">
              {LABEL_POR_MODULO_SLUG[area.slug] ?? area.nombre}
            </span>
            <span className="text-brand-ink dark:text-brand-vanilla">{formatMoney(area.total)}</span>
          </div>
        ))}

        <div className="mt-1 flex items-center justify-between border-t border-brand-vanilla-dark pt-1 dark:border-brand-green-700">
          <span className="text-brand-ink/70 dark:text-brand-vanilla/70">Total ingresos</span>
          <span className="font-medium text-brand-ink dark:text-brand-vanilla">{formatMoney(totalIngresos)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-brand-ink/70 dark:text-brand-vanilla/70">Total egresos</span>
          <span className="font-medium text-red-600">-{formatMoney(totalEgresos)}</span>
        </div>

        <div className="mt-1 flex items-center justify-between border-t border-brand-green-600 pt-2 text-base dark:border-brand-green-500">
          <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">Total general</span>
          <span className="font-bold text-brand-green-700 dark:text-brand-vanilla">
            {formatMoney(resumen.saldos.general)}
          </span>
        </div>
      </div>

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
