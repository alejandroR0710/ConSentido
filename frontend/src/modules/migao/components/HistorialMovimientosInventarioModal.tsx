import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi, type InventarioMovimientoGlobal } from "../api";
import { formatCantidad } from "../format";

interface HistorialMovimientosInventarioModalProps {
  tipo: "entrada" | "ajuste";
  onCerrar: () => void;
}

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Historial global (todos los productos) de un solo tipo de movimiento de
 *  inventario — "entrada" muestra qué llegó y cuándo, "ajuste" muestra el
 *  motivo de cada corrección de conteo (siempre trae uno, el backend lo
 *  exige al registrarlo). Botón aparte en InventarioPage, uno por tipo. */
export function HistorialMovimientosInventarioModal({ tipo, onCerrar }: HistorialMovimientosInventarioModalProps) {
  const [movimientos, setMovimientos] = useState<InventarioMovimientoGlobal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migaoApi
      .listarMovimientosInventarioGlobal(tipo)
      .then(setMovimientos)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }, [tipo]);

  const titulo = tipo === "entrada" ? "Historial de ingresos" : "Historial de ajustes";

  return (
    <Modal titulo={titulo} onCerrar={onCerrar} maxWidth="sm:max-w-3xl">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : movimientos.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-sm text-brand-ink/60 dark:border-brand-green-700">
          {tipo === "entrada" ? "Todavía no hay entradas registradas." : "Todavía no hay ajustes registrados."}
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="sticky top-0 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Cantidad</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Fecha y hora</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => {
                const cantidad = Number(m.cantidad_unidades);
                return (
                  <tr key={m.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2 font-medium">{m.producto_nombre}</td>
                    <td
                      className={`px-3 py-2 font-semibold ${
                        cantidad < 0 ? "text-red-600" : "text-brand-green-700 dark:text-brand-vanilla"
                      }`}
                    >
                      {cantidad > 0 ? "+" : ""}
                      {formatCantidad(m.cantidad_unidades)}
                    </td>
                    <td className="px-3 py-2 text-brand-ink/70 dark:text-brand-vanilla/70">{m.motivo ?? "—"}</td>
                    <td className="px-3 py-2 text-brand-ink/70 dark:text-brand-vanilla/70">
                      {m.usuario_nombre ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-brand-ink/60 dark:text-brand-vanilla/60">
                      {formatearFechaHora(m.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
