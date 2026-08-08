import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../../shared/auth/useAuth";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { Modal } from "../../../shared/components/Modal";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import {
  cajaApi,
  type AcumuladoTotal,
  type CategoriaGasto,
  type DiaHistorialCaja,
  type EdicionHistorialCaja,
  type MovimientoCaja,
  type TurnoCaja,
} from "../api";
import { analyticsApi, type AnalyticsGeneral } from "../../general/api";
import { BotonFactura } from "../../migao/components/BotonFactura";
import { AgregarMovimientoHistoricoModal } from "../components/AgregarMovimientoHistoricoModal";
import { AnularVentaModal } from "../components/AnularVentaModal";
import { BorrarHistorialDiaModal } from "../components/BorrarHistorialDiaModal";
import { BorrarTurnoModal } from "../components/BorrarTurnoModal";
import { BotonImprimirMovimiento } from "../components/BotonImprimirMovimiento";
import { EditarMovimientoHistoricoModal } from "../components/EditarMovimientoHistoricoModal";
import { EgresoAcumuladoModal } from "../components/EgresoAcumuladoModal";
import { resumenAReciboProps } from "../factura";
import { agruparPorEtiqueta, LABEL_POR_MODULO_SLUG } from "../moduloOrigen";

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
const POLL_MS = 15000;

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
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [edicionesDelDia, setEdicionesDelDia] = useState<EdicionHistorialCaja[]>([]);
  const [agregarAbierto, setAgregarAbierto] = useState(false);
  const [imprimirResumenDia, setImprimirResumenDia] = useState(false);
  const [movimientoAEditar, setMovimientoAEditar] = useState<MovimientoCaja | null>(null);
  const [movimientoAAnular, setMovimientoAAnular] = useState<MovimientoCaja | null>(null);

  // Acumulado histórico total (desde la primera venta) — nunca un contador
  // guardado, siempre recalculado en vivo (ver caja.service.ts::obtenerAcumuladoTotal).
  const [acumulado, setAcumulado] = useState<AcumuladoTotal | null>(null);
  const [egresoAcumuladoAbierto, setEgresoAcumuladoAbierto] = useState(false);
  const [verEgresosAcumulado, setVerEgresosAcumulado] = useState(false);

  // Resumen totalizado (ingresos/egresos + desglose por área) de un rango de
  // fechas elegido a mano — reusa el mismo endpoint de analíticas generales
  // que ya usa el Dashboard (analyticsApi.obtenerGeneral).
  const [desdeRango, setDesdeRango] = useState(fechaISO(inicioDeSemana(new Date())));
  const [hastaRango, setHastaRango] = useState(fechaISO(new Date()));
  const [resumenRango, setResumenRango] = useState<AnalyticsGeneral | null>(null);
  const [cargandoRango, setCargandoRango] = useState(false);
  const [errorRango, setErrorRango] = useState<string | null>(null);

  // No pone loading=true en cada llamada (solo el estado inicial ya lo es):
  // así el sondeo de fondo actualiza los datos sin ocultar la pantalla con
  // "Cargando..." cada 15s — solo se ve ese mensaje en la carga inicial.
  async function cargarHistorial() {
    setError(null);
    try {
      setDias(await cajaApi.obtenerHistorialAnual(anio));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }

  async function cargarAcumulado() {
    try {
      setAcumulado(await cajaApi.obtenerAcumuladoTotal());
    } catch {
      /* el cuadro de acumulado simplemente no se actualiza */
    }
  }

  useRegistrarRefresco(async () => {
    await Promise.all([cargarHistorial(), cargarAcumulado()]);
  });

  useEffect(() => {
    cargarHistorial();
    const intervalo = setInterval(cargarHistorial, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio]);

  useEffect(() => {
    cajaApi.listarCategoriasGasto().then(setCategorias).catch(() => {});
    cargarAcumulado();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function consultarRango() {
    setCargandoRango(true);
    setErrorRango(null);
    try {
      setResumenRango(await analyticsApi.obtenerGeneral(desdeRango, hastaRango));
    } catch (err) {
      setErrorRango(err instanceof ApiError ? err.message : "No se pudo cargar el resumen del rango");
    } finally {
      setCargandoRango(false);
    }
  }

  function cargarEdicionesDelDia(fecha: string) {
    cajaApi
      .listarEdicionesDelDia(fecha)
      .then(setEdicionesDelDia)
      .catch(() => {
        /* el historial de cambios simplemente queda vacío */
      });
  }

  function seleccionarDia(dia: DiaHistorialCaja) {
    setDiaSeleccionado(dia);
    setTurnosDelDia([]);
    setMovimientosDelDia([]);
    setEdicionesDelDia([]);
    setCargandoMovimientos(true);
    cajaApi
      .listarMovimientosPorFecha(dia.fecha)
      .then(setMovimientosDelDia)
      .catch(() => {
        /* el detalle simplemente queda vacío; el resumen ya cargado se ve igual */
      })
      .finally(() => setCargandoMovimientos(false));
    cargarEdicionesDelDia(dia.fecha);
    if (esSuperRoot) {
      cajaApi
        .listarTurnosPorFecha(dia.fecha)
        .then(setTurnosDelDia)
        .catch(() => {
          /* la lista de turnos del día simplemente queda vacía */
        });
    }
  }

  // Mientras el modal de un día quede abierto, su detalle también se
  // refresca solo — así se ve en vivo si sigue entrando/saliendo dinero ese
  // mismo día, sin depender de cerrar el turno para "ver" el cambio.
  useEffect(() => {
    if (!diaSeleccionado) return;
    const intervalo = setInterval(() => {
      cajaApi
        .listarMovimientosPorFecha(diaSeleccionado.fecha)
        .then(setMovimientosDelDia)
        .catch(() => {});
      cargarEdicionesDelDia(diaSeleccionado.fecha);
      if (esSuperRoot) {
        cajaApi
          .listarTurnosPorFecha(diaSeleccionado.fecha)
          .then(setTurnosDelDia)
          .catch(() => {});
      }
    }, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaSeleccionado]);

  // Tras agregar/editar un movimiento retroactivo, se refresca todo lo que
  // pudo cambiar: el detalle del día, su historial de cambios, y el grid
  // mensual (el neto del día pudo variar).
  async function refrescarTrasAjuste() {
    if (!diaSeleccionado) return;
    await Promise.all([
      cajaApi.listarMovimientosPorFecha(diaSeleccionado.fecha).then(setMovimientosDelDia),
      cargarHistorial(),
    ]);
    cargarEdicionesDelDia(diaSeleccionado.fecha);
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
          <BotonVolver to="/caja" />
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

      <div className="rounded-lg border-2 border-brand-green-600 bg-brand-green-50 p-4 dark:border-brand-green-500 dark:bg-brand-green-700/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla">
              Acumulado histórico total (desde la primera venta)
            </div>
            <div className="mt-1 text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
              {acumulado ? formatMoney(acumulado.efectivo + acumulado.banco) : "…"}
            </div>
            <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              Efectivo {acumulado ? formatMoney(acumulado.efectivo) : "…"} · Banco{" "}
              {acumulado ? formatMoney(acumulado.banco) : "…"}
            </div>
            {acumulado && (
              <div className="mt-2 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                Ingresos {formatMoney(acumulado.ingresosEfectivo + acumulado.ingresosBanco)} (Efectivo{" "}
                {formatMoney(acumulado.ingresosEfectivo)} · Banco {formatMoney(acumulado.ingresosBanco)}) · Egresos{" "}
                {formatMoney(acumulado.egresosEfectivo + acumulado.egresosBanco)} (Efectivo{" "}
                {formatMoney(acumulado.egresosEfectivo)} · Banco {formatMoney(acumulado.egresosBanco)})
              </div>
            )}
          </div>
          <button
            onClick={() => setEgresoAcumuladoAbierto(true)}
            className="shrink-0 rounded-md bg-brand-green-700 px-3 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
          >
            − Egreso del acumulado
          </button>
        </div>

        {acumulado && acumulado.egresos.length > 0 && (
          <div className="mt-3 border-t border-brand-green-600/30 pt-2 dark:border-brand-vanilla/30">
            <button
              onClick={() => setVerEgresosAcumulado((v) => !v)}
              className="text-xs font-medium text-brand-green-700 underline dark:text-brand-vanilla"
            >
              {verEgresosAcumulado ? "Ocultar" : "Ver"} egresos del acumulado ({acumulado.egresos.length})
            </button>
            {verEgresosAcumulado && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-brand-ink dark:text-brand-vanilla">
                {acumulado.egresos.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {new Date(e.created_at).toLocaleDateString("es")} · {e.categoria_nombre}
                      {e.proveedor_nombre && ` · ${e.proveedor_nombre}`} · {e.motivo}
                      {e.usuario_nombre && (
                        <span className="text-brand-ink/50 dark:text-brand-vanilla/50"> ({e.usuario_nombre})</span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold capitalize">
                      {e.metodo_pago} {formatMoney(e.monto)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ResumenCard titulo="Hoy" totales={totalHoy} />
        <ResumenCard titulo="Esta semana" totales={totalSemana} />
        <ResumenCard titulo="Este mes" totales={totalMes} />
      </div>

      <div className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
        <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">
          Resumen de un rango de fechas
        </h2>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Desde</label>
            <input
              type="date"
              value={desdeRango}
              onChange={(e) => setDesdeRango(e.target.value)}
              className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Hasta</label>
            <input
              type="date"
              value={hastaRango}
              onChange={(e) => setHastaRango(e.target.value)}
              className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>
          <button
            onClick={consultarRango}
            disabled={cargandoRango}
            className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {cargandoRango ? "Consultando..." : "Ver resumen"}
          </button>
        </div>

        {errorRango && <p className="mb-3 text-sm text-red-600">{errorRango}</p>}

        {resumenRango && (
          <>
            <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <ResumenCard
                titulo="Rango seleccionado"
                totales={{
                  ingresos: resumenRango.resumenGeneral.ingresos_totales,
                  egresos: resumenRango.resumenGeneral.egresos_totales,
                  neto: resumenRango.resumenGeneral.saldo_neto,
                }}
              />
            </div>

            <h3 className="mb-2 text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">Por área</h3>
            {resumenRango.porModulo.length === 0 ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                Sin movimientos en este rango.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                    <tr>
                      <th className="px-3 py-2">Área</th>
                      <th className="px-3 py-2 text-right">Ingresos</th>
                      <th className="px-3 py-2 text-right">Egresos</th>
                      <th className="px-3 py-2 text-right">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenRango.porModulo.map((m) => (
                      <tr key={m.modulo_id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                        <td className="px-3 py-2">{m.modulo_nombre}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(m.ingresos)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(m.egresos)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatMoney(m.saldo_neto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
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
        <Modal
          titulo={diaSeleccionado.fecha}
          onCerrar={() => {
            setDiaSeleccionado(null);
            setImprimirResumenDia(false);
          }}
          maxWidth="sm:max-w-lg"
        >
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
            <div className="mt-1 flex items-center justify-between text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              <span>
                {diaSeleccionado.movimientos} movimiento{diaSeleccionado.movimientos === 1 ? "" : "s"} ese día.
              </span>
              {movimientosDelDia.length > 0 && (
                <button
                  onClick={() => setImprimirResumenDia(true)}
                  className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                >
                  🖨️ Imprimir resumen del día
                </button>
              )}
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
                      {(() => {
                        // Una cuenta dividida/mixta genera UN movimiento por cada línea
                        // de pago (misma venta_id repetida varias veces) — el botón de
                        // factura solo se muestra en la primera, si no se ve repetido
                        // una vez por línea de pago de la misma cuenta.
                        const facturaYaMostradaDeVenta = new Set<string>();
                        return movimientosDelDia.map((m) => {
                        const puedeEditar = m.tipo === "egreso" || !m.referencia_entidad;
                        const puedeAnular =
                          m.tipo === "ingreso" &&
                          (m.referencia_entidad === "ventas" || m.referencia_entidad === "con_sentido_ventas");
                        // Factura solo existe para ventas de Migao y Con Sentido (los
                        // únicos módulos que registran una venta con ítems) — otros
                        // orígenes (talleres, insumos, etc.) todavía no tienen este sistema.
                        const puedeVerFactura =
                          m.tipo === "ingreso" &&
                          !!m.referencia_id &&
                          ((m.referencia_entidad === "ventas" && m.modulo_origen_slug === "migao") ||
                            (m.referencia_entidad === "con_sentido_ventas" && m.modulo_origen_slug === "con_sentido")) &&
                          !facturaYaMostradaDeVenta.has(m.referencia_id);
                        if (puedeVerFactura) facturaYaMostradaDeVenta.add(m.referencia_id!);
                        return (
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
                                {m.numero_factura && (
                                  <span className="font-mono text-brand-ink/70 dark:text-brand-vanilla/70">
                                    {" "}
                                    · Fact. {m.numero_factura}
                                  </span>
                                )}
                              </div>
                              {m.descuento_porcentaje != null && (
                                <div className="text-amber-700 dark:text-amber-400">
                                  Sin descuento: {formatMoney(m.monto_sin_descuento!)} · -
                                  {Number(m.descuento_porcentaje)}%
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span
                                className={`font-semibold ${
                                  m.tipo === "ingreso" ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"
                                }`}
                              >
                                {m.tipo === "egreso" ? "-" : "+"}
                                {formatMoney(m.monto)}
                              </span>
                              {puedeVerFactura ? (
                                <BotonFactura
                                  origen={
                                    m.modulo_origen_slug === "con_sentido"
                                      ? { tipo: "venta_con_sentido", id: m.referencia_id! }
                                      : { tipo: "venta", id: m.referencia_id! }
                                  }
                                  className="rounded border border-brand-vanilla-dark px-1.5 py-0.5 text-[11px] text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                />
                              ) : (
                                <BotonImprimirMovimiento
                                  movimiento={m}
                                  className="rounded border border-brand-vanilla-dark px-1.5 py-0.5 text-[11px] text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                />
                              )}
                              {puedeEditar && (
                                <button
                                  onClick={() => setMovimientoAEditar(m)}
                                  className="rounded border border-brand-vanilla-dark px-1.5 py-0.5 text-[11px] text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                >
                                  Editar
                                </button>
                              )}
                              {puedeAnular && (
                                <button
                                  onClick={() => setMovimientoAAnular(m)}
                                  className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                                >
                                  Anular
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      });
                      })()}
                    </div>
                  </div>
                </>
              )
            )}

            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-300 p-3 dark:border-amber-700">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Ajustar historial de este día
                </span>
                <button
                  onClick={() => setAgregarAbierto(true)}
                  className="rounded-md border border-amber-500 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                >
                  + Agregar movimiento
                </button>
              </div>

              {edicionesDelDia.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                    Historial de cambios de este día
                  </span>
                  <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
                    {edicionesDelDia.map((e) => (
                      <div
                        key={e.id}
                        className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla-dark/10 px-2 py-1.5 text-[11px] dark:border-brand-green-700"
                      >
                        <div className="flex justify-between text-brand-ink dark:text-brand-vanilla">
                          <span className="font-medium">
                            {e.accion === "creado" ? "Movimiento agregado" : "Movimiento editado"}
                          </span>
                          <span className="text-brand-ink/50 dark:text-brand-vanilla/50">
                            {formatearHora(e.createdAt)} · {e.usuarioNombre ?? "—"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-brand-ink/70 dark:text-brand-vanilla/70">"{e.nota}"</div>
                        {e.accion === "editado" && e.datosAntes && (
                          <div className="mt-0.5 text-brand-ink/50 dark:text-brand-vanilla/50">
                            Antes: {formatMoney(Number(e.datosAntes.monto))} · {String(e.datosAntes.metodo_pago)} →
                            Después: {formatMoney(Number(e.datosDespues.monto))} ·{" "}
                            {String(e.datosDespues.metodo_pago)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

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

      {agregarAbierto && diaSeleccionado && (
        <AgregarMovimientoHistoricoModal
          fecha={diaSeleccionado.fecha}
          categorias={categorias}
          onCerrar={() => setAgregarAbierto(false)}
          onAgregado={refrescarTrasAjuste}
        />
      )}

      {imprimirResumenDia && diaSeleccionado && (
        <ModalImprimir
          {...resumenAReciboProps({
            fecha: new Date().toISOString(),
            camposEncabezado: [{ etiqueta: "Día", valor: diaSeleccionado.fecha }],
            ingresos: agruparPorEtiqueta(movimientosDelDia, "ingreso").map(([etiqueta, monto]) => ({
              etiqueta,
              monto,
            })),
            egresos: agruparPorEtiqueta(movimientosDelDia, "egreso").map(([etiqueta, monto]) => ({
              etiqueta,
              monto,
            })),
          })}
          onCerrar={() => setImprimirResumenDia(false)}
        />
      )}

      {movimientoAEditar && (
        <EditarMovimientoHistoricoModal
          movimiento={movimientoAEditar}
          categorias={categorias}
          onCerrar={() => setMovimientoAEditar(null)}
          onGuardado={refrescarTrasAjuste}
        />
      )}

      {movimientoAAnular && (
        <AnularVentaModal
          movimiento={movimientoAAnular}
          onCerrar={() => setMovimientoAAnular(null)}
          onAnulado={refrescarTrasAjuste}
        />
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

      {egresoAcumuladoAbierto && (
        <EgresoAcumuladoModal
          categorias={categorias}
          onCerrar={() => setEgresoAcumuladoAbierto(false)}
          onRegistrado={cargarAcumulado}
        />
      )}
    </div>
  );
}
