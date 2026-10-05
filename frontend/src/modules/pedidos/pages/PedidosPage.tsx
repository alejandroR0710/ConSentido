import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { formatMoney } from "../../../shared/format/money";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { pedidosApi, type EstadoPedido, type Pedido } from "../api";
import { NuevoPedidoModal } from "../components/NuevoPedidoModal";

const POLL_MS = 15000;

const TABS: { valor: EstadoPedido | "todos" | "vencidos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "alistado", etiqueta: "Alistado" },
  { valor: "enviado", etiqueta: "Enviado" },
  { valor: "entregado", etiqueta: "Entregado" },
  { valor: "cancelado", etiqueta: "Cancelado" },
  { valor: "vencidos", etiqueta: "⚠ Vencidos" },
];

const ESTILO_ESTADO: Record<EstadoPedido, string> = {
  pendiente: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  alistado: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  enviado: "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400",
  entregado: "bg-brand-green-100 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla",
  cancelado: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
};

// alistado_en ya es un datetime completo (no un DATE puro como fecha_entrega),
// así que new Date() lo interpreta bien sin el ajuste de zona horaria que sí
// necesita un 'YYYY-MM-DD' simple.
function formatearFechaDespacho(fechaIso: string) {
  return new Date(fechaIso).toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["valor"]>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);

  async function cargar() {
    try {
      const filtros =
        tab === "todos" ? undefined : tab === "vencidos" ? { vencidos: true } : { estado: tab as EstadoPedido };
      setPedidos(await pedidosApi.listar(filtros));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos");
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
  }, [tab]);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Pedidos / Encargos</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Lo que piden tus clientes, su envío y en qué va cada uno.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo pedido
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b-2 border-brand-vanilla-dark pb-2 dark:border-brand-green-700">
        {TABS.map((t) => (
          <button
            key={t.valor}
            onClick={() => setTab(t.valor)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : pedidos.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-brand-ink/60 dark:border-brand-green-700">
          No hay pedidos en este filtro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Despacho</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => {
                const vencido = p.proxima_alarma_en && new Date(p.proxima_alarma_en) <= new Date();
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                      vencido ? "bg-red-50 dark:bg-red-950/20" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <Link to={`/pedidos/${p.id}`} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                        {p.descripcion.length > 60 ? `${p.descripcion.slice(0, 60)}...` : p.descripcion}
                      </Link>
                      {p.cliente_nombre && (
                        <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">{p.cliente_nombre}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.destinatario_nombre ?? "—"}</td>
                    <td className="px-3 py-2">{p.alistado_en ? formatearFechaDespacho(p.alistado_en) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO_ESTADO[p.estado]}`}>
                        {p.estado}
                        {vencido ? " ⚠" : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatMoney(p.precio_acordado)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalAbierto && (
        <NuevoPedidoModal
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
