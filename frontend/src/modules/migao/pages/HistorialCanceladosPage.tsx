import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { useAuth } from "../../../shared/auth/useAuth";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi, type HistorialCanceladoEntrada } from "../api";
import { labelArea } from "../areas";
import { formatCantidad } from "../format";

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

interface GrupoDiaCancelado {
  fecha: string;
  entradas: HistorialCanceladoEntrada[];
}

/** El historial ya viene ordenado por fecha DESC, así que agrupar es un solo
 *  recorrido: cuando cambia el día (hora Colombia) se abre un grupo nuevo. */
function agruparPorDia(historial: HistorialCanceladoEntrada[]): GrupoDiaCancelado[] {
  const grupos: GrupoDiaCancelado[] = [];
  for (const h of historial) {
    const fecha = fechaBogota(h.closed_at ?? h.created_at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.entradas.push(h);
    } else {
      grupos.push({ fecha, entradas: [h] });
    }
  }
  return grupos;
}

/** Historial separado de órdenes canceladas: nunca generaron un peso (no hay
 *  venta/factura), así que vive aparte del pago diario real con el detalle
 *  completo de qué se había pedido. Exclusivo de Root/Super Root. */
export function HistorialCanceladosPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);

  const [historial, setHistorial] = useState<HistorialCanceladoEntrada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // No pone loading=true en cada llamada: el sondeo de fondo actualiza los
  // datos sin ocultar la pantalla — solo se ve "Cargando..." la primera vez.
  async function cargar() {
    try {
      setHistorial(await migaoApi.listarHistorialCancelado());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial de cancelados");
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

  const totalHistorico = historial.reduce((acc, h) => acc + Number(h.total), 0);
  const grupos = agruparPorDia(historial);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/migao" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Órdenes Canceladas</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Cuentas canceladas antes de cobrarse — nunca generaron un peso, quedan aparte del historial normal con el
          detalle de qué se había pedido.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border-2 border-slate-400 bg-slate-50 px-4 py-3 dark:border-slate-500 dark:bg-slate-800/40">
        <div className="text-xs uppercase tracking-wide text-slate-700 dark:text-slate-300">
          Valor total de lo cancelado (todo el tiempo)
        </div>
        <div className="text-3xl font-bold text-slate-700 dark:text-slate-300">{formatMoney(totalHistorico)}</div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Mesa</th>
              <th className="px-3 py-2">Mesero</th>
              <th className="px-3 py-2">Productos</th>
              <th className="px-3 py-2">Fecha y hora</th>
              <th className="px-3 py-2">Valor</th>
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
                  Todavía no hay órdenes canceladas.
                </td>
              </tr>
            ) : (
              grupos.flatMap((grupo) => {
                const totalDelDia = grupo.entradas.reduce((acc, h) => acc + Number(h.total), 0);
                const filaEncabezado = (
                  <tr
                    key={`dia-${grupo.fecha}`}
                    className="border-t-2 border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-800/30"
                  >
                    <td colSpan={5} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold capitalize text-slate-700 dark:text-slate-300">
                          {formatearFechaLarga(grupo.fecha)}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {grupo.entradas.length} orden(es) · {formatMoney(totalDelDia)}
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
                        <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> ({labelArea(h.mesa_piso)})</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{h.mesero_nombre ?? "—"}</td>
                    <td className="px-3 py-2 text-brand-ink/80 dark:text-brand-vanilla/80">
                      {h.items.length === 0
                        ? "—"
                        : h.items.map((i) => `${formatCantidad(i.cantidad)}× ${i.nombre}`).join(", ")}
                    </td>
                    <td className="px-3 py-2">{formatearFechaHora(h.closed_at ?? h.created_at)}</td>
                    <td className="px-3 py-2 font-semibold">{formatMoney(h.total)}</td>
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
