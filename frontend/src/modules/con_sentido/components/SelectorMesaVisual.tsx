import { useEffect, useState } from "react";
import { migaoApi, type OrdenResumen } from "../../migao/api";

interface SelectorMesaVisualProps {
  onElegirMesa: (ordenId: string) => void;
}

/** Selector visual de mesas para la Puerta 2 de la venta combinada mesa +
 *  Con Sentido (ver docs/superpowers/specs/2026-10-19-venta-combinada-mesa-con-sentido-design.md).
 *  Solo se pueden elegir mesas que tengan una orden abierta en Migao — sin
 *  orden no hay a qué vincular el carrito. Agrupadas por piso. */
export function SelectorMesaVisual({ onElegirMesa }: SelectorMesaVisualProps) {
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migaoApi
      .listarOrdenesAbiertas()
      .then(setOrdenes)
      .catch(() => setError("No se pudieron cargar las mesas con órdenes abiertas"))
      .finally(() => setCargando(false));
  }, []);

  const conMesa = ordenes.filter((o) => o.mesa_numero);
  const porPiso = new Map<number, OrdenResumen[]>();
  for (const orden of conMesa) {
    const piso = orden.mesa_piso ?? 1;
    const lista = porPiso.get(piso) ?? [];
    lista.push(orden);
    porPiso.set(piso, lista);
  }

  if (cargando) return <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando mesas...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (conMesa.length === 0) {
    return (
      <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
        No hay ninguna mesa con una orden abierta en este momento.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...porPiso.entries()].sort(([a], [b]) => a - b).map(([piso, ordenesDelPiso]) => (
        <div key={piso}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
            Piso {piso}
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ordenesDelPiso.map((orden) => (
              <button
                key={orden.id}
                type="button"
                onClick={() => onElegirMesa(orden.id)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-brand-vanilla-dark p-2 text-left hover:border-brand-green-600 hover:bg-brand-green-50 dark:border-brand-green-700 dark:hover:bg-brand-green-700/40"
              >
                <span className="text-sm font-semibold text-brand-ink dark:text-brand-vanilla">
                  Mesa {orden.mesa_numero}
                </span>
                <span className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                  {orden.estado} · {orden.comensal_numero} comensal{orden.comensal_numero === 1 ? "" : "es"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
