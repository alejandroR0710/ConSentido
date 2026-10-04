import { Link } from "react-router-dom";
import { Modal } from "../../../shared/components/Modal";
import { formatMoney } from "../../../shared/format/money";
import type { OrdenResumen } from "../../migao/api";

interface OrdenesAbiertasAvisoProps {
  ordenes: OrdenResumen[];
  onCerrar: () => void;
}

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Se muestra en vez de abrir el cierre de turno cuando todavía hay cuentas
 * abiertas en Migao — "Ir a cobrar" deja a MigaoPage abrir esa cuenta
 * puntual directo (ver MigaoPage.tsx, lee ?orden= de la URL), sin tener que
 * buscarla a mano en el plano de mesas.
 */
export function OrdenesAbiertasAviso({ ordenes, onCerrar }: OrdenesAbiertasAvisoProps) {
  return (
    <Modal titulo="No se puede cerrar el turno todavía" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
        Hay {ordenes.length} cuenta{ordenes.length === 1 ? "" : "s"} todavía abierta{ordenes.length === 1 ? "" : "s"} en
        Migao. Cierra cada una antes de cerrar el turno del día.
      </p>
      <ul className="flex flex-col gap-2">
        {ordenes.map((o) => (
          <li key={o.id} className="rounded-md border border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-brand-green-700 dark:text-brand-vanilla">
                {o.mesa_numero ? `Mesa ${o.mesa_numero}` : o.nombre ?? "Cuenta sin mesa"}
                {o.mesa_piso ? ` · Piso ${o.mesa_piso}` : ""}
              </span>
              <Link
                to={`/migao?orden=${o.id}`}
                onClick={onCerrar}
                className="shrink-0 rounded-md bg-brand-green-700 px-3 py-1 text-xs font-semibold text-brand-vanilla hover:bg-brand-green-600"
              >
                Ir a cobrar
              </Link>
            </div>
            <p className="mt-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
              {o.mesero_nombre ? `Mesero: ${o.mesero_nombre} · ` : ""}
              Abierta: {formatearHora(o.created_at)} · Total: {formatMoney(o.total)}
              {Number(o.pendiente_cobro) > 0 ? ` · Pendiente de cobro: ${formatMoney(o.pendiente_cobro)}` : ""}
              {" · "}
              <span className="capitalize">{o.estado.replace("_", " ")}</span>
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
