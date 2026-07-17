import { useEffect, useState } from "react";
import { formatMoney } from "../../../shared/format/money";
import { migaoApi, type OrdenItem } from "../api";
import { formatCantidad } from "../format";

interface DetalleCuentaMigaoProps {
  ordenId: string;
  mesaNumero: string | null;
  mesaPiso: number | null;
  meseroNombre: string | null;
  numeroPersonas: number | null;
  fecha: string | null;
}

function formatearFechaHora(fechaIso: string | null) {
  if (!fechaIso) return "—";
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Contexto de la cuenta (mesa, mesero, personas, fecha y productos) que se
 *  muestra al corregir el método de pago desde el historial de Migao — sin
 *  esto, Super Root tendría que adivinar a qué cuenta corresponde el monto. */
export function DetalleCuentaMigao({
  ordenId,
  mesaNumero,
  mesaPiso,
  meseroNombre,
  numeroPersonas,
  fecha,
}: DetalleCuentaMigaoProps) {
  const [items, setItems] = useState<OrdenItem[] | null>(null);

  useEffect(() => {
    migaoApi
      .obtenerDetalle(ordenId)
      .then((detalle) => setItems(detalle.items))
      .catch(() => setItems([]));
  }, [ordenId]);

  return (
    <div className="mb-4 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-brand-ink/70 dark:text-brand-vanilla/70">
        <div>
          <span className="font-medium">Mesa:</span> {mesaNumero ?? "—"}
          {mesaPiso ? ` (piso ${mesaPiso})` : ""}
        </div>
        <div>
          <span className="font-medium">Mesero:</span> {meseroNombre ?? "—"}
        </div>
        <div>
          <span className="font-medium">Personas:</span> {numeroPersonas ?? "—"}
        </div>
        <div>
          <span className="font-medium">Fecha:</span> {formatearFechaHora(fecha)}
        </div>
      </div>

      <div className="border-t border-brand-vanilla-dark pt-2 dark:border-brand-green-700">
        <div className="mb-1 text-xs font-medium text-brand-ink/70 dark:text-brand-vanilla/70">Productos</div>
        {items === null ? (
          <p className="text-xs text-brand-ink/50">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-brand-ink/50">Sin productos.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.id} className="text-xs">
                <div className="flex items-center justify-between">
                  <span>
                    {formatCantidad(item.cantidad)}× {item.producto_nombre}
                  </span>
                  <span>{formatMoney(item.subtotal)}</span>
                </div>
                {item.observaciones && (
                  <div className="font-semibold text-amber-700 dark:text-amber-400">⚠ {item.observaciones}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
