import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type EstadoVale, type FuenteVale, type TipoVale, type Vale } from "../api";
import { NuevoValeModal } from "../components/NuevoValeModal";

const POLL_MS = 20000;

const LABEL_FUENTE: Record<FuenteVale, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

const LABEL_TIPO: Record<TipoVale, string> = {
  pago: "Pago",
  deuda: "Deuda",
};

const FILTROS_TIPO: { valor: TipoVale | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los tipos" },
  { valor: "pago", etiqueta: "Pago" },
  { valor: "deuda", etiqueta: "Deuda" },
];

const FILTROS_FUENTE: { valor: FuenteVale | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas las fuentes" },
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Acumulado" },
  { valor: "dueno", etiqueta: "Bolsillo de dueño" },
];

const FILTROS_ESTADO: { valor: EstadoVale | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activo", etiqueta: "Activos / pendientes" },
  { valor: "resuelto", etiqueta: "Repuestos / cobrados" },
  { valor: "anulado", etiqueta: "Anulados" },
];

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// "Resuelto" depende del tipo: para un pago es repuesto_en (solo aplica si
// fuente="dueno"); para una deuda es cobrado_en — son obligaciones
// independientes (ver spec). Una deuda con préstamo de un dueño que YA se
// le repuso al dueño pero todavía NO se le ha cobrado al empleado/cliente
// debe seguir contando como "activo"/pendiente, nunca resuelta solo porque
// repuesto_en tiene valor.
function estadoVale(v: Vale): EstadoVale {
  if (v.anulado_en) return "anulado";
  const resuelto = v.tipo === "deuda" ? Boolean(v.cobrado_en) : Boolean(v.repuesto_en);
  return resuelto ? "resuelto" : "activo";
}

/** La misma palabra "resuelto" significa cosas distintas según el tipo —
 *  "Repuesto" para un pago financiado por un dueño, "Cobrada" para una
 *  deuda — y "activo" también cambia: "Pendiente de cobro" para una deuda. */
function labelEstado(v: Vale, estado: EstadoVale): string {
  if (estado === "anulado") return "Anulado";
  if (v.tipo === "deuda") return estado === "resuelto" ? "Cobrada" : "Pendiente de cobro";
  return estado === "resuelto" ? "Repuesto" : "Activo";
}

function montoVale(v: Vale): number {
  return v.fuente ? Number(v.monto_efectivo) + Number(v.monto_banco) : Number(v.monto_adeudado ?? 0);
}

const ESTILO_ESTADO: Record<EstadoVale, string> = {
  activo: "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  resuelto: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  anulado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

export function ValesPage() {
  const [vales, setVales] = useState<Vale[]>([]);
  const [filtroTipo, setFiltroTipo] = useState<TipoVale | "todos">("todos");
  const [filtroFuente, setFiltroFuente] = useState<FuenteVale | "todas">("todas");
  const [filtroEstado, setFiltroEstado] = useState<EstadoVale | "todos">("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      setVales(
        await valesApi.listar({
          tipo: filtroTipo === "todos" ? undefined : filtroTipo,
          fuente: filtroFuente === "todas" ? undefined : filtroFuente,
          estado: filtroEstado === "todos" ? undefined : filtroEstado,
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los vales");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroTipo, filtroFuente, filtroEstado]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vales</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Comprobantes de dinero ya entregado, o deudas que te deben.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo vale
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value as TipoVale | "todos")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_TIPO.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
        <select
          value={filtroFuente}
          onChange={(e) => setFiltroFuente(e.target.value as FuenteVale | "todas")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_FUENTE.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value as EstadoVale | "todos")}
          className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-1.5 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          {FILTROS_ESTADO.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : vales.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          No hay vales en este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Número</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Pagado a</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Fuente</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {vales.map((v) => {
                const estado = estadoVale(v);
                return (
                  <tr key={v.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      <Link to={`/vales/${v.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {v.numero}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{LABEL_TIPO[v.tipo]}</td>
                    <td className="px-3 py-2">{v.pagado_a}</td>
                    <td className="px-3 py-2">{formatearFechaHora(v.created_at)}</td>
                    <td className="px-3 py-2">{v.fuente ? LABEL_FUENTE[v.fuente] : "Sin préstamo"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[estado]}`}>
                        {labelEstado(v, estado)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(montoVale(v))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevoValeModal
          onCerrar={() => setModalAbierto(false)}
          onCreado={async () => {
            setModalAbierto(false);
            await cargar();
          }}
        />
      )}
    </div>
  );
}
