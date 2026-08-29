import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { formatMoney as formatearMoneda } from "../../../shared/format/money";
import { EditarMetodoPagoModal } from "../../../shared/components/EditarMetodoPagoModal";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { cajaApi, type CategoriaGasto, type ModuloOrigenSlug, type MovimientoCaja, type ResumenTurno } from "../api";
import { BotonFactura } from "../../migao/components/BotonFactura";
import { migaoApi } from "../../migao/api";
import { AdministracionModal } from "../components/AdministracionModal";
import { AnularVentaModal } from "../components/AnularVentaModal";
import { BotonImprimirMovimiento } from "../components/BotonImprimirMovimiento";
import { CerrarTurnoModal } from "../components/CerrarTurnoModal";
import { EditarMovimientoHistoricoModal } from "../components/EditarMovimientoHistoricoModal";
import { EgresoModal } from "../components/EgresoModal";
import { resumenAReciboProps } from "../factura";
import { IngresoModal } from "../components/IngresoModal";
import { agruparPorEtiqueta } from "../moduloOrigen";
import { ResetearCajaModal } from "../components/ResetearCajaModal";

const POLL_MS = 10000;

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CajaPage() {
  const { usuario } = useAuth();
  // Reiniciar Caja es exclusivo de Super Root; corregir el método de pago de un
  // movimiento es una capacidad más general que "Root" también tiene.
  const esSuperRoot = usuario?.rol === "Super Root";
  const puedeEditarPagos = tieneAccesoTotal(usuario?.rol);
  // Cajero ve una versión reducida de esta pantalla: nada de sumatorias
  // (efectivo/banco/total general/propinas) mientras el turno sigue abierto
  // — el cuadre completo solo aparece al cerrar caja (CerrarTurnoModal), que
  // ahí sí ofrece imprimirlo. Root/Super Root siguen viendo todo en vivo,
  // mismo criterio de acceso que puedeEditarPagos.
  const puedeVerSumatorias = puedeEditarPagos;

  const [resumen, setResumen] = useState<ResumenTurno | null>(null);
  const [sinTurno, setSinTurno] = useState(false);
  // Aparte del cuadre de Caja General (nunca cuenta ahí, es plata del
  // mesero/personal) — cuadro informativo con lo que entró hoy en propina.
  const [propinasHoy, setPropinasHoy] = useState({ montoEfectivo: 0, montoBanco: 0 });
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [montoInicialEfectivo, setMontoInicialEfectivo] = useState(0);
  const [montoInicialBanco, setMontoInicialBanco] = useState(0);
  const [abriendo, setAbriendo] = useState(false);

  const [modalAbierto, setModalAbierto] = useState<"ingreso" | "egreso" | "cierre" | "reset" | "administracion" | null>(null);
  const [movimientoEditando, setMovimientoEditando] = useState<MovimientoCaja | null>(null);
  const [movimientoAAnular, setMovimientoAAnular] = useState<MovimientoCaja | null>(null);
  const [movimientoAEditarCompleto, setMovimientoAEditarCompleto] = useState<MovimientoCaja | null>(null);
  const [imprimirResumenTurno, setImprimirResumenTurno] = useState(false);
  // Congela el resumen con el que se abrió "Cerrar turno": una vez el cierre
  // se confirma, cargarResumenDeTurnoActual() deja `resumen` en null (ya no
  // hay turno abierto) — sin esta copia aparte, el modal se desmontaría solo
  // y nunca se vería la pantalla de "Turno cerrado, ¿imprimir?".
  const [resumenParaCierre, setResumenParaCierre] = useState<ResumenTurno | null>(null);

  const turnoIdRef = useRef<string | null>(null);
  turnoIdRef.current = resumen?.turno.id ?? null;

  async function cargarCategorias() {
    try {
      setCategorias(await cajaApi.listarCategoriasGasto());
    } catch {
      /* el select de egresos queda vacío */
    }
  }

  async function cargarResumenDeTurnoActual() {
    try {
      const turno = await cajaApi.obtenerTurnoActual();
      if (!turno) {
        setSinTurno(true);
        setResumen(null);
        return;
      }
      setSinTurno(false);
      setResumen(await cajaApi.obtenerResumenTurno(turno.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la caja");
    } finally {
      setLoading(false);
    }
  }

  async function cargarPropinasHoy() {
    try {
      setPropinasHoy(await migaoApi.obtenerPropinasHoy());
    } catch {
      /* cuadro informativo — si falla, simplemente se queda en $0 */
    }
  }

  useEffect(() => {
    cargarCategorias();
    cargarResumenDeTurnoActual();
    cargarPropinasHoy();
    const intervalo = setInterval(() => {
      if (turnoIdRef.current) cargarResumenDeTurnoActual();
      cargarPropinasHoy();
    }, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(() =>
    Promise.all([cargarCategorias(), cargarResumenDeTurnoActual(), cargarPropinasHoy()]),
  );

  async function abrirTurno(e: FormEvent) {
    e.preventDefault();
    setAbriendo(true);
    setError(null);
    setMensaje(null);
    try {
      await cajaApi.abrirTurno(montoInicialEfectivo, montoInicialBanco);
      setMensaje("Turno abierto.");
      await cargarResumenDeTurnoActual();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo abrir el turno");
    } finally {
      setAbriendo(false);
    }
  }

  if (loading) {
    return <p className="text-brand-ink/60">Cargando...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja General</h1>
            <button
              onClick={() => setModalAbierto("administracion")}
              className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            >
              ⚙️ Administrar
            </button>
            {puedeEditarPagos && (
              <Link
                to="/caja/historial"
                className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs font-medium text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              >
                📅 Historial
              </Link>
            )}
          </div>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Un solo turno para todo el negocio. Cada turno arranca con la base que escribas — no se hereda nada del
            día anterior.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      {sinTurno || !resumen ? (
        <form
          onSubmit={abrirTurno}
          className="max-w-sm rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700"
        >
          <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">Abrir turno</h2>

          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Escribe con cuánto arranca la caja hoy (no se hereda nada del día anterior).
          </p>

          <label className="mb-1 block text-xs font-medium">Efectivo inicial</label>
          <MoneyInput
            value={montoInicialEfectivo}
            onChange={setMontoInicialEfectivo}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          <label className="mb-1 block text-xs font-medium">Banco inicial</label>
          <MoneyInput
            value={montoInicialBanco}
            onChange={setMontoInicialBanco}
            className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />

          <button
            type="submit"
            disabled={abriendo}
            className="w-full rounded-md bg-brand-green-700 px-4 py-2 font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {abriendo ? "Abriendo..." : "Abrir turno"}
          </button>
        </form>
      ) : (
        <>
          {puedeVerSumatorias && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-brand-vanilla-dark p-4 text-center dark:border-brand-green-700">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Ganancia en efectivo
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.ingresosEfectivo - resumen.egresosEfectivo)}
              </div>
              <div className="mt-2 border-t border-dashed border-amber-300 pt-2 dark:border-amber-700">
                <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Con propina del día
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(resumen.ingresosEfectivo - resumen.egresosEfectivo + propinasHoy.montoEfectivo)}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-brand-vanilla-dark p-4 text-center dark:border-brand-green-700">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Banco
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.saldos.banco)}
              </div>
              <div className="mt-2 border-t border-dashed border-amber-300 pt-2 dark:border-amber-700">
                <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Con propina del día
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(resumen.saldos.banco + propinasHoy.montoBanco)}
                </div>
              </div>
            </div>
            <div className="rounded-lg border-2 border-brand-green-600 p-4 text-center dark:border-brand-green-500">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Total general
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.saldos.general)}
              </div>
              {/* Aparte, en otro color: cuánto sería el total si se cuenta
                  también la propina del día (esa plata nunca cuenta para el
                  cuadre de arriba, es del mesero/personal, ver cuadro de abajo). */}
              <div className="mt-2 border-t border-dashed border-amber-300 pt-2 dark:border-amber-700">
                <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Con propinas del día
                </div>
                <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(resumen.saldos.general + propinasHoy.montoEfectivo + propinasHoy.montoBanco)}
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Aparte del cuadre de arriba (esta plata nunca cuenta para Caja
              General) — cuánto entró HOY en propina, efectivo y banco. */}
          {puedeVerSumatorias && (
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/20">
            <div className="text-center text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              💵 Propinas de hoy
            </div>
            <div className="text-center text-[11px] text-amber-700/80 dark:text-amber-400/80">
              Aparte del cuadre — dinero del mesero/personal, no cuenta para Caja General.
            </div>
            <div className="mt-3 grid grid-cols-3 divide-x divide-amber-300 dark:divide-amber-700">
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
                  Efectivo
                </div>
                <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(propinasHoy.montoEfectivo)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
                  Banco
                </div>
                <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(propinasHoy.montoBanco)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
                  Total
                </div>
                <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
                  {formatearMoneda(propinasHoy.montoEfectivo + propinasHoy.montoBanco)}
                </div>
              </div>
            </div>
          </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              onClick={() => setModalAbierto("ingreso")}
              className="rounded-md bg-brand-green-700 px-4 py-4 text-lg font-semibold text-brand-vanilla hover:bg-brand-green-600"
            >
              + Ingreso
            </button>
            <button
              onClick={() => setModalAbierto("egreso")}
              className="rounded-md border-2 border-brand-green-700 px-4 py-4 text-lg font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
            >
              − Egreso
            </button>
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium text-brand-green-700 dark:text-brand-vanilla">Movimientos del turno</h2>
              {puedeVerSumatorias && resumen.movimientos.length > 0 && (
                <button
                  onClick={() => setImprimirResumenTurno(true)}
                  className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                >
                  🖨️ Imprimir resumen del turno
                </button>
              )}
            </div>
            {resumen.movimientos.length === 0 ? (
              <p className="text-sm text-brand-ink/60">Sin movimientos todavía.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {(() => {
                  const movimientosPorDia = resumen.movimientos.reduce(
                    (acc, m) => {
                      const fecha = new Date(m.created_at).toLocaleDateString("es-CO");
                      if (!acc[fecha]) acc[fecha] = [];
                      acc[fecha].push(m);
                      return acc;
                    },
                    {} as Record<string, typeof resumen.movimientos>
                  );

                  return Object.entries(movimientosPorDia).map(([fecha, movimientos]) => {
                    const totalIngresos = movimientos
                      .filter((m) => m.tipo === "ingreso")
                      .reduce((sum, m) => sum + Number(m.monto), 0);
                    const totalEgresos = movimientos
                      .filter((m) => m.tipo === "egreso")
                      .reduce((sum, m) => sum + Number(m.monto), 0);

                    return (
                      <div key={fecha} className="rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
                        <div className="mb-4 flex items-center justify-between border-b border-brand-vanilla-dark pb-3 dark:border-brand-green-700">
                          <h3 className="font-semibold text-brand-green-700 dark:text-brand-vanilla">{fecha}</h3>
                          {puedeVerSumatorias && (
                          <div className="flex gap-4">
                            <div className="text-right">
                              <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Ingresos</div>
                              <div className="font-bold text-brand-green-700 dark:text-brand-vanilla">
                                +{formatearMoneda(totalIngresos)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Egresos</div>
                              <div className="font-bold text-red-600">-{formatearMoneda(totalEgresos)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">Balance</div>
                              <div className={`font-bold ${totalIngresos - totalEgresos >= 0 ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"}`}>
                                {formatearMoneda(totalIngresos - totalEgresos)}
                              </div>
                            </div>
                          </div>
                          )}
                        </div>

                        <ul className="flex flex-col gap-2">
                          {(() => {
                            // Una cuenta dividida/mixta genera un movimiento por cada
                            // línea de pago (misma venta repetida) — el botón de
                            // factura solo se muestra en la primera, ver mismo
                            // criterio en CajaHistorialPage.tsx.
                            const facturaYaMostradaDeVenta = new Set<string>();
                            return movimientos.map((m) => {
                            const puedeVerFactura =
                              m.tipo === "ingreso" &&
                              !!m.referencia_id &&
                              (m.referencia_entidad === "caja_ventas" ||
                                (m.referencia_entidad === "ventas" && m.modulo_origen_slug === "migao") ||
                                (m.referencia_entidad === "con_sentido_ventas" && m.modulo_origen_slug === "con_sentido")) &&
                              !facturaYaMostradaDeVenta.has(m.referencia_id);
                            // Una venta nunca se puede editar de verdad (desincroniza
                            // `pagos`) — ahí "Editar" solo corrige método de pago/área,
                            // y la única forma de corregir el valor es anularla del todo.
                            // Un ingreso/egreso manual sí admite editar el monto (mismo
                            // criterio que CajaHistorialPage.tsx, antes solo vivía ahí y
                            // solo con el turno ya cerrado — ya no hace falta esperar).
                            const puedeAnular =
                              m.tipo === "ingreso" &&
                              ["ventas", "caja_ventas", "con_sentido_ventas"].includes(m.referencia_entidad ?? "");
                            const puedeEditarCompleto = m.tipo === "egreso" || !m.referencia_entidad;
                            if (puedeVerFactura) facturaYaMostradaDeVenta.add(m.referencia_id!);
                            return (
                            <li
                              key={m.id}
                              className={`rounded-lg border-l-4 bg-brand-vanilla p-3 dark:bg-brand-green-900 ${
                                m.tipo === "ingreso" ? "border-brand-green-600" : "border-red-400"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <div className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                                      {m.modulo_origen_slug ?? m.categoria_gasto_nombre ?? "—"}
                                    </div>
                                    <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{m.metodo_pago}</span>
                                  </div>
                                  {m.motivo && (
                                    <div className="mt-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70 italic">
                                      {m.motivo}
                                    </div>
                                  )}
                                  <div className="mt-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                                    {formatearHora(m.created_at)}
                                    {m.numero_factura && (
                                      <span className="font-mono text-brand-ink/70 dark:text-brand-vanilla/70">
                                        {" "}
                                        · Fact. {m.numero_factura}
                                      </span>
                                    )}
                                  </div>
                                  {m.descuento_porcentaje != null && (
                                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                      Sin descuento: {formatearMoneda(Number(m.monto_sin_descuento))} · -{Number(m.descuento_porcentaje)}%
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`font-semibold ${
                                      m.tipo === "ingreso" ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"
                                    }`}
                                  >
                                    {m.tipo === "egreso" ? "-" : "+"}
                                    {formatearMoneda(Number(m.monto))}
                                  </div>
                                  {puedeVerFactura ? (
                                    <BotonFactura
                                      origen={
                                        m.referencia_entidad === "caja_ventas"
                                          ? { tipo: "venta_caja", id: m.referencia_id! }
                                          : m.modulo_origen_slug === "con_sentido"
                                            ? { tipo: "venta_con_sentido", id: m.referencia_id! }
                                            : { tipo: "venta", id: m.referencia_id! }
                                      }
                                      className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                    />
                                  ) : (
                                    <BotonImprimirMovimiento
                                      movimiento={m}
                                      className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                    />
                                  )}
                                  {puedeEditarPagos && (
                                    <button
                                      onClick={() =>
                                        puedeEditarCompleto ? setMovimientoAEditarCompleto(m) : setMovimientoEditando(m)
                                      }
                                      className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                                    >
                                      Editar
                                    </button>
                                  )}
                                  {puedeEditarPagos && puedeAnular && (
                                    <button
                                      onClick={() => setMovimientoAAnular(m)}
                                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                                    >
                                      Anular
                                    </button>
                                  )}
                                </div>
                              </div>
                            </li>
                            );
                          });
                          })()}
                        </ul>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setResumenParaCierre(resumen);
              setModalAbierto("cierre");
            }}
            className="w-full max-w-xs rounded-md border border-red-300 px-4 py-2 font-medium text-red-600 hover:bg-red-50"
          >
            Cerrar turno
          </button>
        </>
      )}

      {esSuperRoot && (
        <div className="rounded-lg border-2 border-dashed border-red-300 p-4 dark:border-red-800">
          <h2 className="mb-1 font-medium text-red-600">Zona de Super Root</h2>
          <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Reinicia el saldo de Caja a $0. Los ingresos y turnos anteriores no se borran, pero los egresos del turno
            abierto sí se borran por completo.
          </p>
          <button
            onClick={() => setModalAbierto("reset")}
            className="w-full max-w-xs rounded-md border-2 border-red-600 px-4 py-2 font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            Reiniciar Caja a $0
          </button>
        </div>
      )}

      {modalAbierto === "ingreso" && (
        <IngresoModal onCerrar={() => setModalAbierto(null)} onRegistrado={cargarResumenDeTurnoActual} />
      )}

      {modalAbierto === "egreso" && (
        <EgresoModal
          categorias={categorias}
          onCerrar={() => setModalAbierto(null)}
          onRegistrado={cargarResumenDeTurnoActual}
        />
      )}

      {modalAbierto === "cierre" && resumenParaCierre && (
        <CerrarTurnoModal
          resumen={resumenParaCierre}
          onCerrar={() => {
            setModalAbierto(null);
            setResumenParaCierre(null);
          }}
          onCerrado={async (mensajeCierre) => {
            setMensaje(mensajeCierre);
            await cargarResumenDeTurnoActual();
          }}
        />
      )}

      {modalAbierto === "reset" && (
        <ResetearCajaModal
          onCerrar={() => setModalAbierto(null)}
          onReseteado={async (mensajeReset) => {
            setMensaje(mensajeReset);
            await cargarResumenDeTurnoActual();
          }}
        />
      )}

      {modalAbierto === "administracion" && (
        <AdministracionModal
          onCerrar={() => setModalAbierto(null)}
          onActualizar={cargarResumenDeTurnoActual}
        />
      )}

      {movimientoEditando && (
        <EditarMetodoPagoModal
          movimientoId={movimientoEditando.id}
          metodoPagoActual={movimientoEditando.metodo_pago}
          monto={Number(movimientoEditando.monto)}
          etiqueta={movimientoEditando.modulo_origen_slug ?? movimientoEditando.categoria_gasto_nombre ?? "Movimiento"}
          tipo={movimientoEditando.tipo}
          moduloOrigenActual={movimientoEditando.modulo_origen_slug as ModuloOrigenSlug | null}
          onCerrar={() => setMovimientoEditando(null)}
          onGuardado={cargarResumenDeTurnoActual}
        />
      )}

      {movimientoAAnular && (
        <AnularVentaModal
          movimiento={movimientoAAnular}
          onCerrar={() => setMovimientoAAnular(null)}
          onAnulado={cargarResumenDeTurnoActual}
        />
      )}

      {movimientoAEditarCompleto && (
        <EditarMovimientoHistoricoModal
          movimiento={movimientoAEditarCompleto}
          categorias={categorias}
          onCerrar={() => setMovimientoAEditarCompleto(null)}
          onGuardado={cargarResumenDeTurnoActual}
        />
      )}

      {imprimirResumenTurno && resumen && (
        <ModalImprimir
          {...resumenAReciboProps({
            fecha: new Date().toISOString(),
            camposEncabezado: [
              { etiqueta: "Turno abierto", valor: formatearHora(resumen.turno.abiertoEn) },
            ],
            movimientos: resumen.movimientos,
            ingresos: agruparPorEtiqueta(resumen.movimientos, "ingreso").map(([etiqueta, monto]) => ({
              etiqueta,
              monto,
            })),
            egresos: agruparPorEtiqueta(resumen.movimientos, "egreso").map(([etiqueta, monto]) => ({
              etiqueta,
              monto,
            })),
          })}
          onCerrar={() => setImprimirResumenTurno(false)}
        />
      )}
    </div>
  );
}
