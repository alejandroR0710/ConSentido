import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../../../shared/auth/useAuth";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney as formatearMoneda } from "../../../shared/format/money";
import { EditarMetodoPagoModal } from "../../../shared/components/EditarMetodoPagoModal";
import { cajaApi, type CategoriaGasto, type MovimientoCaja, type ProyeccionApertura, type ResumenTurno } from "../api";
import { CerrarTurnoModal } from "../components/CerrarTurnoModal";
import { EgresoModal } from "../components/EgresoModal";
import { IngresoModal } from "../components/IngresoModal";
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
  const esSuperRoot = usuario?.rol === "Super Root";

  const [resumen, setResumen] = useState<ResumenTurno | null>(null);
  const [sinTurno, setSinTurno] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [proyeccion, setProyeccion] = useState<ProyeccionApertura | null>(null);
  const [montoInicialEfectivo, setMontoInicialEfectivo] = useState(0);
  const [montoInicialBanco, setMontoInicialBanco] = useState(0);
  const [abriendo, setAbriendo] = useState(false);

  const [modalAbierto, setModalAbierto] = useState<"ingreso" | "egreso" | "cierre" | "reset" | null>(null);
  const [movimientoEditando, setMovimientoEditando] = useState<MovimientoCaja | null>(null);

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
        try {
          setProyeccion(await cajaApi.obtenerProyeccionApertura());
        } catch {
          /* si falla, el formulario simplemente no muestra la proyección */
        }
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

  useEffect(() => {
    cargarCategorias();
    cargarResumenDeTurnoActual();
    const intervalo = setInterval(() => {
      if (turnoIdRef.current) cargarResumenDeTurnoActual();
    }, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

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
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Caja General</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Un solo turno para todo el negocio. El saldo inicial se hereda del cierre anterior.
          </p>
        </div>
        <div className="rounded-lg border-2 border-brand-green-600 px-4 py-2 text-right dark:border-brand-green-500">
          <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Efectivo que debe haber
          </div>
          <div className="text-2xl font-bold text-brand-green-700 dark:text-brand-vanilla">
            {formatearMoneda(resumen ? resumen.saldos.efectivo : (proyeccion?.montoInicialEfectivo ?? 0))}
          </div>
          <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
            Base con la que abrió el turno:{" "}
            {formatearMoneda(
              resumen ? Number(resumen.turno.montoInicialEfectivo) : (proyeccion?.montoInicialEfectivo ?? 0),
            )}
          </div>
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

          {proyeccion?.hayCierreAnterior ? (
            <>
              <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                Con lo que dejó el cierre anterior, este turno abre así (no hace falta escribir nada):
              </p>
              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-brand-vanilla-dark p-3 text-center dark:border-brand-green-700">
                  <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                    Efectivo
                  </div>
                  <div className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                    {formatearMoneda(proyeccion.montoInicialEfectivo)}
                  </div>
                </div>
                <div className="rounded-md border border-brand-vanilla-dark p-3 text-center dark:border-brand-green-700">
                  <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                    Banco
                  </div>
                  <div className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                    {formatearMoneda(proyeccion.montoInicialBanco)}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                Todavía no hay ningún cierre anterior (primer turno de la caja) — escribe con cuánto arranca.
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
            </>
          )}

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-brand-vanilla-dark p-4 text-center dark:border-brand-green-700">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Efectivo
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.saldos.efectivo)}
              </div>
            </div>
            <div className="rounded-lg border border-brand-vanilla-dark p-4 text-center dark:border-brand-green-700">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Banco
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.saldos.banco)}
              </div>
            </div>
            <div className="rounded-lg border-2 border-brand-green-600 p-4 text-center dark:border-brand-green-500">
              <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                Total general
              </div>
              <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                {formatearMoneda(resumen.saldos.general)}
              </div>
            </div>
          </div>

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
            <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">Movimientos del turno</h2>
            {resumen.movimientos.length === 0 ? (
              <p className="text-sm text-brand-ink/60">Sin movimientos todavía.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {resumen.movimientos.map((m) => (
                  <li
                    key={m.id}
                    className={`flex items-center justify-between rounded-lg border-l-4 bg-brand-vanilla p-3 dark:bg-brand-green-900 ${
                      m.tipo === "ingreso" ? "border-brand-green-600" : "border-red-400"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-brand-ink dark:text-brand-vanilla">
                        {m.modulo_origen_slug ?? m.categoria_gasto_nombre ?? "—"}
                        <span className="ml-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                          {m.metodo_pago}
                        </span>
                      </div>
                      <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                        {formatearHora(m.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className={`text-base font-semibold ${
                          m.tipo === "ingreso" ? "text-brand-green-700 dark:text-brand-vanilla" : "text-red-600"
                        }`}
                      >
                        {m.tipo === "egreso" ? "-" : "+"}
                        {formatearMoneda(Number(m.monto))}
                      </div>
                      {esSuperRoot && (
                        <button
                          onClick={() => setMovimientoEditando(m)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={() => setModalAbierto("cierre")}
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
            Reinicia el saldo de Caja a $0 sin borrar el historial de turnos y movimientos anteriores.
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
          onCategoriaCreada={(categoria) => setCategorias((actual) => [...actual, categoria])}
        />
      )}

      {modalAbierto === "cierre" && resumen && (
        <CerrarTurnoModal
          turnoId={resumen.turno.id}
          onCerrar={() => setModalAbierto(null)}
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

      {movimientoEditando && (
        <EditarMetodoPagoModal
          movimientoId={movimientoEditando.id}
          metodoPagoActual={movimientoEditando.metodo_pago}
          monto={Number(movimientoEditando.monto)}
          etiqueta={movimientoEditando.modulo_origen_slug ?? movimientoEditando.categoria_gasto_nombre ?? "Movimiento"}
          onCerrar={() => setMovimientoEditando(null)}
          onGuardado={cargarResumenDeTurnoActual}
        />
      )}
    </div>
  );
}
