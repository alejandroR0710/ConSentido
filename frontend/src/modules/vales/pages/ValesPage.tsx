import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { valesApi, type FuenteVale, type Vale } from "../api";
import { NuevoValeModal } from "../components/NuevoValeModal";

const POLL_MS = 20000;

const LABEL_FUENTE: Record<FuenteVale, string> = {
  turno: "Turno abierto",
  acumulado: "Acumulado",
  dueno: "Bolsillo de dueño",
};

const FILTROS_FUENTE: { valor: FuenteVale | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas las fuentes" },
  { valor: "turno", etiqueta: "Turno abierto" },
  { valor: "acumulado", etiqueta: "Acumulado" },
  { valor: "dueno", etiqueta: "Bolsillo de dueño" },
];

const FILTROS_ESTADO: { valor: "todos" | "activo" | "repuesto" | "anulado"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activo", etiqueta: "Activos" },
  { valor: "repuesto", etiqueta: "Repuestos" },
  { valor: "anulado", etiqueta: "Anulados" },
];

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function estadoVale(v: Vale): "activo" | "repuesto" | "anulado" {
  if (v.anulado_en) return "anulado";
  if (v.repuesto_en) return "repuesto";
  return "activo";
}

const ESTILO_ESTADO: Record<"activo" | "repuesto" | "anulado", string> = {
  activo: "bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  repuesto: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  anulado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

export function ValesPage() {
  const [vales, setVales] = useState<Vale[]>([]);
  const [filtroFuente, setFiltroFuente] = useState<FuenteVale | "todas">("todas");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "activo" | "repuesto" | "anulado">("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      setVales(
        await valesApi.listar({
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
  }, [filtroFuente, filtroEstado]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Vales</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Comprobantes de dinero ya entregado, con su fuente de fondos.
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
          onChange={(e) => setFiltroEstado(e.target.value as "todos" | "activo" | "repuesto" | "anulado")}
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
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Número</th>
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
                const monto = Number(v.monto_efectivo) + Number(v.monto_banco);
                return (
                  <tr key={v.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2">
                      <Link to={`/vales/${v.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {v.numero}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{v.pagado_a}</td>
                    <td className="px-3 py-2">{formatearFechaHora(v.created_at)}</td>
                    <td className="px-3 py-2">{LABEL_FUENTE[v.fuente]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[estado]}`}>{estado}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(monto)}</td>
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
