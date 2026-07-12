import type { HistorialEntry } from "../api";

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

const ACCION_META: Record<HistorialEntry["accion"], { icono: string; color: string }> = {
  item_agregado: { icono: "➕", color: "border-brand-green-600" },
  item_editado: { icono: "✏️", color: "border-amber-500" },
  item_cancelado: { icono: "🚫", color: "border-red-400" },
  item_entregado: { icono: "✅", color: "border-brand-green-700" },
};

function describir(h: HistorialEntry): string {
  const producto = h.producto_nombre ?? "un producto";
  switch (h.accion) {
    case "item_agregado":
      return `Agregó ${h.detalle?.cantidad ?? ""}× ${producto}`;
    case "item_editado":
      return `Cambió la cantidad de ${producto}: ${h.detalle?.cantidadAnterior ?? "?"} → ${h.detalle?.cantidadNueva ?? "?"}`;
    case "item_cancelado":
      return `Canceló ${producto} (tenía ${h.detalle?.cantidadAnterior ?? "?"})`;
    case "item_entregado":
      return `Marcó ${producto} como entregado`;
    default:
      return producto;
  }
}

/** Contenido del historial de una orden — se muestra dentro de un <Modal>. */
export function HistorialOrden({ entradas }: { entradas: HistorialEntry[] }) {
  if (entradas.length === 0) {
    return <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Todavía no hay cambios registrados.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {entradas.map((h) => {
        const meta = ACCION_META[h.accion];
        return (
          <li key={h.id} className={`border-l-4 ${meta.color} py-1 pl-3`}>
            <div className="flex items-baseline gap-2 text-sm">
              <span aria-hidden>{meta.icono}</span>
              <span className="text-brand-ink dark:text-brand-vanilla">{describir(h)}</span>
            </div>
            <div className="pl-5 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              {formatearHora(h.created_at)} · {h.usuario_nombre ?? "—"}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
