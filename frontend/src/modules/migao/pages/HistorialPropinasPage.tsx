import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { Modal } from "../../../shared/components/Modal";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { useAuth } from "../../../shared/auth/useAuth";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type PropinaEntrada } from "../api";
import { labelArea } from "../areas";
import { BotonFactura } from "../components/BotonFactura";

const POLL_MS = 15000;

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Fecha calendario en hora Colombia de un timestamp ISO, en formato
 *  'YYYY-MM-DD' — mismo criterio usado en Historial Migao, para agrupar por día. */
function fechaBogota(fechaIso: string) {
  return new Date(fechaIso).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** `fecha` ya es 'YYYY-MM-DD' en hora Colombia — se arma con el constructor de
 *  3 argumentos para que quede en hora LOCAL del navegador sin correrse un día. */
function formatearFechaLarga(fecha: string) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(anio, mes - 1, dia);
  return `${DIAS_SEMANA[d.getDay()]} ${dia} de ${MESES[mes - 1]}`;
}

interface GrupoDiaPropinas {
  fecha: string;
  entradas: PropinaEntrada[];
}

/** El historial ya viene ordenado por fecha DESC, así que agrupar es un solo
 *  recorrido: cuando cambia el día (hora Colombia) se abre un grupo nuevo. */
function agruparPorDia(historial: PropinaEntrada[]): GrupoDiaPropinas[] {
  const grupos: GrupoDiaPropinas[] = [];
  for (const p of historial) {
    const fecha = fechaBogota(p.created_at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.entradas.push(p);
    } else {
      grupos.push({ fecha, entradas: [p] });
    }
  }
  return grupos;
}

/** Propinas: dinero del mesero/personal, nunca cuenta para Caja General —
 *  vive en su propio historial con su propia sumatoria. El "pendiente por
 *  repartir" se calcula en vivo filtrando las que no tienen `liquidada_en`
 *  (nunca se guarda un contador aparte, ver migao.repository.ts::listPropinas).
 *  Exclusivo de Root/Super Root. */
export function HistorialPropinasPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);

  const [historial, setHistorial] = useState<PropinaEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [repartiendo, setRepartiendo] = useState<"efectivo" | "banco" | null>(null);
  const [notaReparto, setNotaReparto] = useState("");
  const [procesandoReparto, setProcesandoReparto] = useState(false);
  const [errorReparto, setErrorReparto] = useState<string | null>(null);

  // No pone loading=true en cada llamada: el sondeo de fondo actualiza los
  // datos sin ocultar la pantalla — solo se ve "Cargando..." la primera vez.
  async function cargar() {
    try {
      setHistorial(await migaoApi.listarPropinas());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial de propinas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  if (!puedeVer) {
    return <Navigate to="/migao" replace />;
  }

  const totalHistorico = historial.reduce((acc, p) => acc + Number(p.monto), 0);
  const pendientes = historial.filter((p) => !p.liquidada_en);
  const pendienteEfectivo = pendientes
    .filter((p) => p.metodo_pago === "efectivo")
    .reduce((acc, p) => acc + Number(p.monto), 0);
  const pendienteBanco = pendientes
    .filter((p) => p.metodo_pago === "banco")
    .reduce((acc, p) => acc + Number(p.monto), 0);
  const grupos = agruparPorDia(historial);

  async function confirmarReparto() {
    if (!repartiendo) return;
    setProcesandoReparto(true);
    setErrorReparto(null);
    try {
      await migaoApi.repartirPropinas(repartiendo, notaReparto.trim() || undefined);
      setRepartiendo(null);
      setNotaReparto("");
      await cargar();
    } catch (err) {
      setErrorReparto(err instanceof ApiError ? err.message : "No se pudo repartir la propina");
    } finally {
      setProcesandoReparto(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/migao" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial de Propinas</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Propinas registradas al cobrar — dinero del mesero/personal, no cuenta para el cuadre de Caja General.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border-2 border-brand-green-600 bg-brand-green-50 px-4 py-3 dark:border-brand-green-500 dark:bg-brand-green-700/20">
        <div className="text-xs uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla">
          Pendiente por repartir
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6">
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <span className="text-sm text-brand-ink dark:text-brand-vanilla">
              Efectivo <span className="font-bold">{formatMoney(pendienteEfectivo)}</span>
            </span>
            <button
              onClick={() => setRepartiendo("efectivo")}
              disabled={pendienteEfectivo <= 0}
              className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-40"
            >
              Repartir
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <span className="text-sm text-brand-ink dark:text-brand-vanilla">
              Banco <span className="font-bold">{formatMoney(pendienteBanco)}</span>
            </span>
            <button
              onClick={() => setRepartiendo("banco")}
              disabled={pendienteBanco <= 0}
              className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-40"
            >
              Repartir
            </button>
          </div>
        </div>
        <div className="mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
          Total histórico (todo el tiempo): {formatMoney(totalHistorico)}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Mesa</th>
              <th className="px-3 py-2">Mesero</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">%</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Fecha y hora</th>
              <th className="px-3 py-2">Monto</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : historial.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-brand-ink/60">
                  Todavía no hay propinas registradas.
                </td>
              </tr>
            ) : (
              grupos.flatMap((grupo) => {
                const totalDelDia = grupo.entradas.reduce((acc, p) => acc + Number(p.monto), 0);
                const filaEncabezado = (
                  <tr
                    key={`dia-${grupo.fecha}`}
                    className="border-t-2 border-brand-green-600 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-900/20"
                  >
                    <td colSpan={8} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold capitalize text-brand-green-700 dark:text-brand-vanilla">
                          {formatearFechaLarga(grupo.fecha)}
                        </span>
                        <span className="text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                          Total {formatMoney(totalDelDia)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );

                const filasDelDia = grupo.entradas.map((p) => (
                  <tr key={p.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      {p.mesa_numero ?? "—"}
                      {p.mesa_piso && (
                        <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> ({labelArea(p.mesa_piso)})</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.mesero_nombre ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
                          {p.numero_factura ?? "—"}
                        </span>
                        {p.venta_id && (
                          <BotonFactura
                            origen={{ tipo: "venta", id: p.venta_id }}
                            className="rounded border border-brand-vanilla-dark px-1.5 py-0.5 text-[11px] text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 capitalize">{p.metodo_pago}</td>
                    <td className="px-3 py-2">{p.porcentaje ? `${p.porcentaje}%` : "Personalizado"}</td>
                    <td className="px-3 py-2">
                      {p.liquidada_en ? (
                        <span className="rounded-full bg-brand-green-100 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                          Repartida {formatearFechaHora(p.liquidada_en)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{formatearFechaHora(p.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{formatMoney(p.monto)}</td>
                  </tr>
                ));

                return [filaEncabezado, ...filasDelDia];
              })
            )}
          </tbody>
        </table>
      </div>

      {repartiendo && (
        <Modal
          titulo={`Repartir propinas en ${repartiendo}`}
          onCerrar={() => {
            setRepartiendo(null);
            setErrorReparto(null);
          }}
        >
          <p className="mb-3 text-sm text-brand-ink dark:text-brand-vanilla">
            Se va a marcar como repartido{" "}
            <span className="font-bold">
              {formatMoney(repartiendo === "efectivo" ? pendienteEfectivo : pendienteBanco)}
            </span>{" "}
            en {repartiendo}. El historial de cada propina individual no se borra, solo deja de contar como
            pendiente.
          </p>
          <label className="mb-1 block text-xs font-medium">Nota (opcional)</label>
          <input
            value={notaReparto}
            onChange={(e) => setNotaReparto(e.target.value)}
            placeholder="Ej. repartido entre meseros de turno"
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          {errorReparto && <p className="mb-3 text-sm text-red-600">{errorReparto}</p>}
          <button
            onClick={confirmarReparto}
            disabled={procesandoReparto}
            className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
          >
            {procesandoReparto ? "Repartiendo..." : "Confirmar reparto"}
          </button>
        </Modal>
      )}
    </div>
  );
}
