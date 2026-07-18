import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../shared/auth/useAuth";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { Modal } from "../../../shared/components/Modal";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { cajaApi, type DiaHistorialCaja, type MovimientoCaja, type TurnoCaja } from "../api";
import { BorrarHistorialDiaModal } from "../components/BorrarHistorialDiaModal";
import { BorrarTurnoModal } from "../components/BorrarTurnoModal";
import { LABEL_POR_MODULO_SLUG } from "../moduloOrigen";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

function fechaISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lunes como inicio de semana. */
function inicioDeSemana(fecha: Date) {
  const d = new Date(fecha);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface Totales {
  ingresos: number;
  egresos: number;
  neto: number;
}

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

/** Agrupa movimientos de un mismo tipo (ingreso/egreso) por su etiqueta de
 *  origen (área o categoría de gasto), para mostrar de qué se compone el
 *  total — no solo la suma. */
function agruparPorEtiqueta(movimientos: MovimientoCaja[], tipo: "ingreso" | "egreso") {
  const porEtiqueta = new Map<string, number>();
  for (const m of movimientos) {
    if (m.tipo !== tipo) continue;
    const etiqueta =
      tipo === "ingreso"
        ? (m.modulo_origen_slug ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug) : "Otro")
        : (m.categoria_gasto_nombre ?? "Otro");
    porEtiqueta.set(etiqueta, (porEtiqueta.get(etiqueta) ?? 0) + Number(m.monto));
  }
  return Array.from(porEtiqueta.entries()).sort((a, b) => b[1] - a[1]);
}

function sumar(dias: DiaHistorialCaja[]): Totales {
  return dias.reduce(
    (acc, d) => ({ ingresos: acc.ingresos + d.ingresos, egresos: acc.egresos + d.egresos, neto: acc.neto + d.neto }),
    { ingresos: 0, egresos: 0, neto: 0 },
  );
}

function ResumenCard({ titulo, totales }: { titulo: string; totales: Totales }) {
  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">{titulo}</div>
      <div
        className={`text-2xl font-bold ${
          totales.neto >= 0 ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"
        }`}
      >
        {formatMoney(totales.neto)}
      </div>
      <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
        + {formatMoney(totales.ingresos)} · − {formatMoney(totales.egresos)}
      </div>
    </div>
  );
}

function colorCelda(dia: DiaHistorialCaja | undefined, maxAbs: number) {
  if (!dia || dia.movimientos === 0) {
    return "bg-brand-vanilla-dark/30 text-brand-ink/40 dark:bg-brand-green-900/40 dark:text-brand-vanilla/40";
  }
  const intensidad = maxAbs === 0 ? 0 : Math.min(1, Math.abs(dia.neto) / maxAbs);
  if (dia.neto >= 0) {
    if (intensidad > 0.66) return "bg-brand-green-700 text-brand-vanilla";
    if (intensidad > 0.33) return "bg-brand-green-500 text-brand-vanilla";
    return "bg-brand-green-200 text-brand-ink dark:text-brand-ink";
  }
  if (intensidad > 0.66) return "bg-red-700 text-white";
  if (intensidad > 0.33) return "bg-red-500 text-white";
  return "bg-red-200 text-brand-ink";
}

interface MesGridProps {
  anio: number;
  mesIdx: number;
  porFecha: Map<string, DiaHistorialCaja>;
  maxAbs: number;
  hoyISO: string;
  onSeleccionar: (dia: DiaHistorialCaja) => void;
}

function MesGrid({ anio, mesIdx, porFecha, maxAbs, hoyISO, onSeleccionar }: MesGridProps) {
  const primerDia = new Date(anio, mesIdx, 1);
  const diasEnMes = new Date(anio, mesIdx + 1, 0).getDate();
  const offsetInicial = (primerDia.getDay() + 6) % 7; // 0 = lunes

  const celdas: (number | null)[] = [
    ...Array.from({ length: offsetInicial }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
  ];

  return (
    <div className="rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
      <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">{MESES[mesIdx]}</h3>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-brand-ink/50 dark:text-brand-vanilla/50">
        {DIAS_SEMANA.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celdas.map((dia, idx) => {
          if (dia === null) return <div key={`vacio-${idx}`} />;
          const iso = fechaISO(new Date(anio, mesIdx, dia));
          const info = porFecha.get(iso);
          return (
            <button
              key={iso}
              onClick={() => info && onSeleccionar(info)}
              disabled={!info}
              className={`aspect-square rounded text-[10px] font-medium ${colorCelda(info, maxAbs)} ${
                iso === hoyISO ? "ring-2 ring-brand-green-600 dark:ring-brand-vanilla" : ""
              } ${info ? "cursor-pointer" : "cursor-default"}`}
              title={info ? `${iso}: ${formatMoney(info.neto)}` : iso}
            >
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CajaHistorialPage() {
  const { usuario } = useAuth();
  const esSuperRoot = usuario?.rol === "Super Root";

  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [dias, setDias] = useState<DiaHistorialCaja[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [diaSeleccionado, setDiaSeleccionado] = useState<DiaHistorialCaja | null>(null);
  const [movimientosDelDia, setMovimientosDelDia] = useState<MovimientoCaja[]>([]);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false);
  const [turnosDelDia, setTurnosDelDia] = useState<TurnoCaja[]>([]);
  const [turnoABorrar, setTurnoABorrar] = useState<TurnoCaja | null>(null);
  const [borrarDiaAbierto, setBorrarDiaAbierto] = useState(false);

  async function cargarHistorial() {
    setLoading(true);
    setError(null);
    try {
      setDias(await cajaApi.obtenerHistorialAnual(anio));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }

  useRegistrarRefresco(cargarHistorial);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);
    cajaApi
      .obtenerHistorialAnual(anio)
      .then((data) => {
        if (!cancelado) setDias(data);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [anio]);

  function seleccionarDia(dia: DiaHistorialCaja) {
    setDiaSeleccionado(dia);
    setTurnosDelDia([]);
    setMovimientosDelDia([]);
    setCargandoMovimientos(true);
    cajaApi
      .listarMovimientosPorFecha(dia.fecha)
      .then(setMovimientosDelDia)
      .catch(() => {
        /* el detalle simplemente queda vacío; el resumen ya cargado se ve igual */
      })
      .finally(() => setCargandoMovimientos(false));
    if (esSuperRoot) {
      cajaApi
        .listarTurnosPorFecha(dia.fecha)
        .then(setTurnosDelDia)
        .catch(() => {
          /* la lista de turnos del día simplemente queda vacía */
        });
    }
  }

  const porFecha = useMemo(() => {
    const map = new Map<string, DiaHistorialCaja>();
    for (const d of dias) map.set(d.fecha, d);
    return map;
  }, [dias]);

  const maxAbs = useMemo(() => Math.max(0, ...dias.map((d) => Math.abs(d.neto))), [dias]);

  const hoy = new Date();
  const hoyISO = fechaISO(hoy);
  const inicioSemana = inicioDeSemana(hoy);
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const totalHoy = porFecha.get(hoyISO) ?? { fecha: hoyISO, ingresos: 0, egresos: 0, neto: 0, movimientos: 0 };
  const totalSemana = sumar(dias.filter((d) => d.fecha >= fechaISO(inicioSemana) && d.fecha <= hoyISO));
  const totalMes = sumar(dias.filter((d) => d.fecha >= fechaISO(inicioMes) && d.fecha <= hoyISO));

  // Vista exclusiva de Root/Super Root: el Cajero opera desde "Caja General"
  // pero no tiene por qué auditar el historial de ingresos/egresos.
  if (!tieneAccesoTotal(usuario?.rol)) {
    return <Navigate to="/caja" replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial de Caja</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Resumen de ingresos y egresos por día, semana y mes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnio((a) => a - 1)}
            className="rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm dark:border-brand-green-700"
          >
            ←
          </button>
          <span className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">{anio}</span>
          <button
            onClick={() => setAnio((a) => a + 1)}
            disabled={anio >= anioActual}
            className="rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm disabled:opacity-40 dark:border-brand-green-700"
          >
            →
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ResumenCard titulo="Hoy" totales={totalHoy} />
        <ResumenCard titulo="Esta semana" totales={totalSemana} />
        <ResumenCard titulo="Este mes" totales={totalMes} />
      </div>

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MESES.map((_, mesIdx) => (
            <MesGrid
              key={mesIdx}
              anio={anio}
              mesIdx={mesIdx}
              porFecha={porFecha}
              maxAbs={maxAbs}
              hoyISO={hoyISO}
              onSeleccionar={seleccionarDia}
            />
          ))}
        </div>
      )}

      {diaSeleccionado && (
        <Modal titulo={diaSeleccionado.fecha} onCerrar={() => setDiaSeleccionado(null)} maxWidth="sm:max-w-lg">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-brand-ink/60 dark:text-brand-vanilla/60">Ingresos</span>
              <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">
                {formatMoney(diaSeleccionado.ingresos)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-brand-ink/60 dark:text-brand-vanilla/60">Egresos</span>
              <span className="font-semibold text-red-600">{formatMoney(diaSeleccionado.egresos)}</span>
            </div>
            <div className="flex justify-between border-t border-brand-vanilla-dark pt-2 dark:border-brand-green-700">
              <span className="font-medium">Neto</span>
              <span className="font-bold">{formatMoney(diaSeleccionado.neto)}</span>
            </div>
            <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              {diaSeleccionado.movimientos} movimiento{diaSeleccionado.movimientos === 1 ? "" : "s"} ese día.
            </div>

            {cargandoMovimientos ? (
              <p className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Cargando detalle...</p>
            ) : (
              movimientosDelDia.length > 0 && (
                <>
                  <div className="mt-2 flex flex-col gap-3 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700 sm:flex-row">
                    {agruparPorEtiqueta(movimientosDelDia, "ingreso").length > 0 && (
                      <div className="flex-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                          Ingresos por área
                        </span>
                        <div className="mt-1 flex flex-col gap-0.5">
                          {agruparPorEtiqueta(movimientosDelDia, "ingreso").map(([etiqueta, monto]) => (
                            <div key={etiqueta} className="flex justify-between text-xs">
                              <span className="text-brand-ink/70 dark:text-brand-vanilla/70">{etiqueta}</span>
                              <span className="text-brand-ink dark:text-brand-vanilla">{formatMoney(monto)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {agruparPorEtiqueta(movimientosDelDia, "egreso").length > 0 && (
                      <div className="flex-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                          Egresos por categoría
                        </span>
                        <div className="mt-1 flex flex-col gap-0.5">
                          {agruparPorEtiqueta(movimientosDelDia, "egreso").map(([etiqueta, monto]) => (
                            <div key={etiqueta} className="flex justify-between text-xs">
                              <span className="text-brand-ink/70 dark:text-brand-vanilla/70">{etiqueta}</span>
                              <span className="text-brand-ink dark:text-brand-vanilla">{formatMoney(monto)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-1 flex flex-col gap-1.5 border-t border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
                    <span className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                      Detalle de movimientos
                    </span>
                    <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
                      {movimientosDelDia.map((m) => (
                        <div
                          key={m.id}
                          className={`flex items-center justify-between gap-2 rounded-md border-l-4 bg-brand-vanilla-dark/20 px-2 py-1.5 text-xs dark:bg-brand-green-700/10 ${
                            m.tipo === "ingreso" ? "border-brand-green-600" : "border-red-400"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-brand-ink dark:text-brand-vanilla">
                              {m.tipo === "ingreso"
                                ? (m.modulo_origen_slug
                                    ? (LABEL_POR_MODULO_SLUG[m.modulo_origen_slug] ?? m.modulo_origen_slug)
                                    : "Otro")
                                : (m.categoria_gasto_nombre ?? "Otro")}
                              {m.motivo && <span className="text-brand-ink/50 dark:text-brand-vanilla/50"> · {m.motivo}</span>}
                            </div>
                            <div className="text-brand-ink/50 dark:text-brand-vanilla/50">
                              {formatearHora(m.created_at)} · {m.metodo_pago}
                            </div>
                            {m.descuento_porcentaje != null && (
                              <div className="text-amber-700 dark:text-amber-400">
                                Sin descuento: {formatMoney(m.monto_sin_descuento!)} · -
                                {Number(m.descuento_porcentaje)}%
                              </div>
                            )}
                          </div>
                          <span
                            className={`shrink-0 font-semibold ${
                              m.tipo === "ingreso" ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"
                            }`}
                          >
                            {m.tipo === "egreso" ? "-" : "+"}
                            {formatMoney(m.monto)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )
            )}

            {esSuperRoot && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border-2 border-dashed border-red-300 p-3 dark:border-red-800">
                <span className="text-xs font-medium text-red-600">Zona de Super Root</span>

                {turnosDelDia.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                      Turnos que empezaron este día:
                    </span>
                    {turnosDelDia.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-brand-vanilla-dark px-2 py-1.5 text-xs dark:border-brand-green-700"
                      >
                        <span>
                          {new Date(t.abiertoEn).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} ·{" "}
                          {t.estado === "abierto" ? "abierto" : "cerrado"}
                        </span>
                        <button
                          onClick={() => setTurnoABorrar(t)}
                          disabled={t.estado === "abierto"}
                          title={t.estado === "abierto" ? 'Usa "Reiniciar Caja" para el turno abierto' : undefined}
                          className="rounded-md border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Borrar turno
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setBorrarDiaAbierto(true)}
                  disabled={diaSeleccionado.movimientos === 0}
                  className="w-full rounded-md border-2 border-red-600 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"
                >
                  Borrar historial completo de este día
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {borrarDiaAbierto && diaSeleccionado && (
        <BorrarHistorialDiaModal
          fecha={diaSeleccionado.fecha}
          onCerrar={() => setBorrarDiaAbierto(false)}
          onBorrado={async (msg) => {
            setMensaje(msg);
            setDiaSeleccionado(null);
            await cargarHistorial();
          }}
        />
      )}

      {turnoABorrar && (
        <BorrarTurnoModal
          turno={turnoABorrar}
          onCerrar={() => setTurnoABorrar(null)}
          onBorrado={async (msg) => {
            setMensaje(msg);
            setDiaSeleccionado(null);
            await cargarHistorial();
          }}
        />
      )}
    </div>
  );
}
