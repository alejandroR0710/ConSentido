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

/** Fecha calendario en hora Colombia de un timestamp ISO, en formato
 *  'YYYY-MM-DD' — mismo criterio que el resto de los historiales, para
 *  agrupar por el mismo día que ya usa el resto de la app. */
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

interface GrupoDiaMovimientos {
  fecha: string;
  entradas: InventarioMovimientoGlobal[];
}

/** El historial ya viene ordenado por fecha DESC, así que agrupar es un solo
 *  recorrido: cuando cambia el día (hora Colombia) se abre un grupo nuevo. */
function agruparPorDia(movimientos: InventarioMovimientoGlobal[]): GrupoDiaMovimientos[] {
  const grupos: GrupoDiaMovimientos[] = [];
  for (const m of movimientos) {
    const fecha = fechaBogota(m.created_at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.entradas.push(m);
    } else {
      grupos.push({ fecha, entradas: [m] });
    }
  }
  return grupos;
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
  const grupos = agruparPorDia(movimientos);

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
              {grupos.flatMap((grupo) => {
                const filaEncabezado = (
                  <tr
                    key={`dia-${grupo.fecha}`}
                    className="border-t-2 border-brand-green-600 bg-brand-green-50 dark:border-brand-green-500 dark:bg-brand-green-900/20"
                  >
                    <td colSpan={5} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold capitalize text-brand-green-700 dark:text-brand-vanilla">
                          {formatearFechaLarga(grupo.fecha)}
                        </span>
                        <span className="text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                          {grupo.entradas.length} movimiento{grupo.entradas.length > 1 ? "s" : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                );

                const filasDelDia = grupo.entradas.map((m) => {
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
                });

                return [filaEncabezado, ...filasDelDia];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
