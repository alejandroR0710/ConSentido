import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { migaoApi, type PendientePropinaDia } from "../api";

interface RepartirPropinasModalProps {
  metodoPago: "efectivo" | "banco";
  onCerrar: () => void;
  onRepartido: () => Promise<void> | void;
}

interface FilaEntrega {
  nombrePersona: string;
  monto: number;
  fechaEntrega: string;
  motivo: string;
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 'YYYY-MM-DD' → Date local (sin correrse un día por huso horario). */
function aFechaLocal(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function formatearFechaCorta(fecha: string) {
  const d = aFechaLocal(fecha);
  return `${DIAS_SEMANA[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

/** Hoy en hora Colombia, 'YYYY-MM-DD' — mismo criterio usado en el resto del
 *  módulo para agrupar/filtrar por día calendario. */
function hoyBogota() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Lunes de la semana (ISO) a la que pertenece esta fecha — clave para
 *  agrupar los días pendientes en bloques de "semana completa". */
function lunesDeLaSemana(fecha: string) {
  const d = aFechaLocal(fecha);
  const diaSemana = d.getDay(); // 0=domingo
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
}

interface GrupoSemana {
  lunes: string;
  dias: PendientePropinaDia[];
}

function agruparPorSemana(dias: PendientePropinaDia[]): GrupoSemana[] {
  const mapa = new Map<string, PendientePropinaDia[]>();
  for (const d of dias) {
    const clave = lunesDeLaSemana(d.fecha);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave)!.push(d);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([lunes, dias]) => ({ lunes, dias: dias.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) }));
}

/**
 * Reparto de propinas de un método: primero se eligen qué días concretos
 * entran (una semana completa o sueltos, vía checkboxes agrupados por
 * semana), después se desglosa ese total entre las personas del equipo
 * (nombre + monto + fecha + motivo opcional) — la suma de las entregas tiene
 * que dar exactamente el total de los días elegidos, así el historial por
 * persona siempre cuadra con la plata real repartida.
 */
export function RepartirPropinasModal({ metodoPago, onCerrar, onRepartido }: RepartirPropinasModalProps) {
  const [pendientesDia, setPendientesDia] = useState<PendientePropinaDia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [diasSeleccionados, setDiasSeleccionados] = useState<Set<string>>(new Set());
  const [entregas, setEntregas] = useState<FilaEntrega[]>([
    { nombrePersona: "", monto: 0, fechaEntrega: hoyBogota(), motivo: "" },
  ]);
  const [nota, setNota] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const dias = await migaoApi.obtenerPendientesPropinasPorDia(metodoPago);
        if (cancelado) return;
        setPendientesDia(dias);
        setDiasSeleccionados(new Set(dias.map((d) => d.fecha)));
      } catch (err) {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudieron cargar los días pendientes");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [metodoPago]);

  const gruposSemana = useMemo(() => agruparPorSemana(pendientesDia), [pendientesDia]);

  const totalSeleccionado = pendientesDia
    .filter((d) => diasSeleccionados.has(d.fecha))
    .reduce((acc, d) => acc + d.monto, 0);
  const sumaEntregas = entregas.reduce((acc, e) => acc + (Number.isFinite(e.monto) ? e.monto : 0), 0);
  const restante = totalSeleccionado - sumaEntregas;

  function alternarDia(fecha: string) {
    setDiasSeleccionados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(fecha)) siguiente.delete(fecha);
      else siguiente.add(fecha);
      return siguiente;
    });
  }

  function alternarSemana(grupo: GrupoSemana, marcar: boolean) {
    setDiasSeleccionados((prev) => {
      const siguiente = new Set(prev);
      for (const d of grupo.dias) {
        if (marcar) siguiente.add(d.fecha);
        else siguiente.delete(d.fecha);
      }
      return siguiente;
    });
  }

  function actualizarEntrega(indice: number, campo: keyof FilaEntrega, valor: string | number) {
    setEntregas((prev) => prev.map((e, i) => (i === indice ? { ...e, [campo]: valor } : e)));
  }

  function agregarEntrega() {
    setEntregas((prev) => [...prev, { nombrePersona: "", monto: 0, fechaEntrega: hoyBogota(), motivo: "" }]);
  }

  function quitarEntrega(indice: number) {
    setEntregas((prev) => prev.filter((_, i) => i !== indice));
  }

  /** Llena el monto de esta fila con lo que falte para cuadrar — atajo para
   *  el caso más común (repartir todo entre 1-2 personas). */
  function usarRestante(indice: number) {
    const otras = entregas.reduce((acc, e, i) => (i === indice ? acc : acc + (Number.isFinite(e.monto) ? e.monto : 0)), 0);
    const sugerido = Math.max(0, totalSeleccionado - otras);
    actualizarEntrega(indice, "monto", sugerido);
  }

  const entregasValidas = entregas.every((e) => e.nombrePersona.trim().length > 0 && e.monto > 0);
  const puedeRepartir =
    !cargando &&
    diasSeleccionados.size > 0 &&
    totalSeleccionado > 0 &&
    entregas.length > 0 &&
    entregasValidas &&
    Math.abs(restante) < 1;

  async function confirmar() {
    if (!puedeRepartir) return;
    setProcesando(true);
    setError(null);
    try {
      await migaoApi.repartirPropinas({
        metodoPago,
        fechas: Array.from(diasSeleccionados),
        nota: nota.trim() || undefined,
        entregas: entregas.map((e) => ({
          nombrePersona: e.nombrePersona.trim(),
          monto: e.monto,
          fechaEntrega: e.fechaEntrega || undefined,
          motivo: e.motivo.trim() || undefined,
        })),
      });
      await onRepartido();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo repartir la propina");
    } finally {
      setProcesando(false);
    }
  }

  const inputClase =
    "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

  return (
    <Modal titulo={`Repartir propinas en ${metodoPago}`} onCerrar={onCerrar} maxWidth="sm:max-w-2xl">
      {cargando ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando días pendientes...</p>
      ) : pendientesDia.length === 0 ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
          No hay propinas pendientes de {metodoPago}.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Paso 1: elegir días */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              1. ¿Qué días vas a repartir?
            </h3>
            <div className="flex flex-col gap-3">
              {gruposSemana.map((grupo) => {
                const todosMarcados = grupo.dias.every((d) => diasSeleccionados.has(d.fecha));
                const totalSemana = grupo.dias.reduce((acc, d) => acc + d.monto, 0);
                return (
                  <div
                    key={grupo.lunes}
                    className="rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700"
                  >
                    <label className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={todosMarcados}
                          onChange={(e) => alternarSemana(grupo, e.target.checked)}
                        />
                        Semana del {formatearFechaCorta(grupo.lunes)}
                      </span>
                      <span>{formatMoney(totalSemana)}</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {grupo.dias.map((d) => (
                        <label
                          key={d.fecha}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                            diasSeleccionados.has(d.fecha)
                              ? "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-700/30"
                              : "border-brand-vanilla-dark dark:border-brand-green-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={diasSeleccionados.has(d.fecha)}
                            onChange={() => alternarDia(d.fecha)}
                          />
                          {formatearFechaCorta(d.fecha)} · {formatMoney(d.monto)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-brand-ink dark:text-brand-vanilla">
              Total seleccionado: <span className="font-bold">{formatMoney(totalSeleccionado)}</span>
            </p>
          </div>

          {/* Paso 2: entregas por persona */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">
              2. ¿A quién se le entrega?
            </h3>
            <div className="flex flex-col gap-2">
              {entregas.map((entrega, indice) => (
                <div
                  key={indice}
                  className="grid grid-cols-1 gap-2 rounded-md border border-brand-vanilla-dark p-2 sm:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto] sm:items-end dark:border-brand-green-700"
                >
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Nombre</label>
                    <input
                      value={entrega.nombrePersona}
                      onChange={(e) => actualizarEntrega(indice, "nombrePersona", e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      className={inputClase}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Monto</label>
                    <div className="flex items-center gap-1">
                      <MoneyInput
                        value={entrega.monto}
                        onChange={(v) => actualizarEntrega(indice, "monto", v)}
                        className={inputClase}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Fecha</label>
                    <input
                      type="date"
                      value={entrega.fechaEntrega}
                      onChange={(e) => actualizarEntrega(indice, "fechaEntrega", e.target.value)}
                      className={inputClase}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium">Motivo (opcional)</label>
                    <input
                      value={entrega.motivo}
                      onChange={(e) => actualizarEntrega(indice, "motivo", e.target.value)}
                      placeholder="Ej. turno completo"
                      className={inputClase}
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => usarRestante(indice)}
                      title="Llenar con lo que falte"
                      className="rounded-md border border-brand-green-600 px-2 py-1.5 text-xs text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                    >
                      =Resto
                    </button>
                    {entregas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarEntrega(indice)}
                        title="Quitar"
                        className="rounded-md border border-red-400 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={agregarEntrega}
              className="mt-2 rounded-md border border-brand-green-600 px-3 py-1.5 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
            >
              + Agregar persona
            </button>

            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${
                Math.abs(restante) < 1
                  ? "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
              }`}
            >
              {Math.abs(restante) < 1
                ? "Todo el monto seleccionado quedó asignado."
                : restante > 0
                  ? `Falta asignar ${formatMoney(restante)}`
                  : `Te pasaste por ${formatMoney(-restante)}`}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Nota general del reparto (opcional)</label>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej. repartido entre meseros de turno"
              className={inputClase}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={confirmar}
            disabled={procesando || !puedeRepartir}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {procesando ? "Repartiendo..." : "Confirmar reparto"}
          </button>
        </div>
      )}
    </Modal>
  );
}
