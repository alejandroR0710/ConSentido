import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { useAuth } from "../../../shared/auth/useAuth";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type HistorialAdministrativoEntrada } from "../api";

const POLL_MS = 15000;

function formatearFechaHora(fechaIso: string | null) {
  if (!fechaIso) return "—";
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

interface GrupoDiaAdministrativo {
  fecha: string;
  entradas: HistorialAdministrativoEntrada[];
}

/** El historial ya viene ordenado por fecha DESC, así que agrupar es un solo
 *  recorrido: cuando cambia el día (hora Colombia) se abre un grupo nuevo. */
function agruparPorDia(historial: HistorialAdministrativoEntrada[]): GrupoDiaAdministrativo[] {
  const grupos: GrupoDiaAdministrativo[] = [];
  for (const h of historial) {
    const fecha = fechaBogota(h.closed_at ?? new Date().toISOString());
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.entradas.push(h);
    } else {
      grupos.push({ fecha, entradas: [h] });
    }
  }
  return grupos;
}

/** Cuentas cerradas con pago "administrativo": no generan ingreso en Caja
 *  General, así que viven en su propio historial con su propia sumatoria —
 *  completamente aparte del pago diario real. Exclusivo de Root/Super Root. */
export function HistorialAdministrativoPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);

  const [historial, setHistorial] = useState<HistorialAdministrativoEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No pone loading=true en cada llamada: el sondeo de fondo actualiza los
  // datos sin ocultar la pantalla — solo se ve "Cargando..." la primera vez.
  async function cargar() {
    try {
      setHistorial(await migaoApi.listarHistorialAdministrativo());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial administrativo");
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

  const totalAcumulado = historial.reduce((acc, h) => acc + Number(h.total_cobrado), 0);
  const grupos = agruparPorDia(historial);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/migao" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Historial Administrativo</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cuentas cerradas con pago administrativo — no generan ingreso en Caja General, quedan aparte del pago
          diario real.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 dark:border-amber-600 dark:bg-amber-950/20">
        <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">Total acumulado</div>
        <div className="text-3xl font-bold text-amber-700 dark:text-amber-400">{formatMoney(totalAcumulado)}</div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Mesa</th>
              <th className="px-3 py-2">Mesero</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2">Fecha y hora</th>
              <th className="px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : historial.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-brand-ink/60">
                  Todavía no hay cuentas con pago administrativo.
                </td>
              </tr>
            ) : (
              grupos.flatMap((grupo) => {
                const totalDelDia = grupo.entradas.reduce((acc, h) => acc + Number(h.total_cobrado), 0);
                const filaEncabezado = (
                  <tr
                    key={`dia-${grupo.fecha}`}
                    className="border-t-2 border-amber-500 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20"
                  >
                    <td colSpan={5} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold capitalize text-amber-700 dark:text-amber-400">
                          {formatearFechaLarga(grupo.fecha)}
                        </span>
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                          Total {formatMoney(totalDelDia)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );

                const filasDelDia = grupo.entradas.map((h) => (
                  <tr key={h.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      {h.mesa_numero ?? "—"}
                      {h.mesa_piso && (
                        <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> (salón {h.mesa_piso})</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{h.mesero_nombre ?? "—"}</td>
                    <td className="px-3 py-2">{h.referencia ?? "—"}</td>
                    <td className="px-3 py-2">{formatearFechaHora(h.closed_at)}</td>
                    <td className="px-3 py-2">
                      {h.descuento_porcentaje > 0 ? (
                        <>
                          <div className="text-xs text-brand-ink/50 line-through dark:text-brand-vanilla/50">
                            {formatMoney(h.total)}
                          </div>
                          <div>
                            {formatMoney(h.total_cobrado)}{" "}
                            <span className="text-xs text-amber-700 dark:text-amber-400">
                              (-{h.descuento_porcentaje}%)
                            </span>
                          </div>
                        </>
                      ) : (
                        formatMoney(h.total_cobrado)
                      )}
                    </td>
                  </tr>
                ));

                return [filaEncabezado, ...filasDelDia];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
