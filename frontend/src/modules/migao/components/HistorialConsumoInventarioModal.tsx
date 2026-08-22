import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { migaoApi, type ConsumoInventarioEntrada } from "../api";
import { labelArea } from "../areas";
import { formatCantidad } from "../format";

interface HistorialConsumoInventarioModalProps {
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
 *  'YYYY-MM-DD' — mismo criterio que el resto de los historiales. */
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

interface GrupoDiaConsumo {
  fecha: string;
  entradas: ConsumoInventarioEntrada[];
}

/** El historial ya viene ordenado por fecha DESC, así que agrupar es un solo
 *  recorrido: cuando cambia el día (hora Colombia) se abre un grupo nuevo. */
function agruparPorDia(consumo: ConsumoInventarioEntrada[]): GrupoDiaConsumo[] {
  const grupos: GrupoDiaConsumo[] = [];
  for (const c of consumo) {
    const fecha = fechaBogota(c.created_at);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === fecha) {
      ultimo.entradas.push(c);
    } else {
      grupos.push({ fecha, entradas: [c] });
    }
  }
  return grupos;
}

/** Historial de salidas de inventario: insumos descontados automáticamente
 *  al servir un producto del menú (nunca a mano, ver
 *  inventario.service.ts::aplicarConsumoPorProducto), con la orden/mesa de
 *  dónde vino cada uno. Botón aparte en InventarioPage. */
export function HistorialConsumoInventarioModal({ onCerrar }: HistorialConsumoInventarioModalProps) {
  const [consumo, setConsumo] = useState<ConsumoInventarioEntrada[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migaoApi
      .listarConsumoInventario()
      .then(setConsumo)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }, []);

  const grupos = agruparPorDia(consumo);

  return (
    <Modal titulo="Historial de salidas" onCerrar={onCerrar} maxWidth="sm:max-w-4xl">
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : consumo.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-sm text-brand-ink/60 dark:border-brand-green-700">
          Todavía no hay salidas registradas.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="sticky top-0 bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
              <tr>
                <th className="px-3 py-2">Insumo</th>
                <th className="px-3 py-2">Cantidad</th>
                <th className="px-3 py-2">Producto vendido</th>
                <th className="px-3 py-2">Mesa</th>
                <th className="px-3 py-2">Mesero</th>
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
                    <td colSpan={6} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-semibold capitalize text-brand-green-700 dark:text-brand-vanilla">
                          {formatearFechaLarga(grupo.fecha)}
                        </span>
                        <span className="text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                          {grupo.entradas.length} salida{grupo.entradas.length > 1 ? "s" : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                );

                const filasDelDia = grupo.entradas.map((c) => (
                  <tr key={c.id} className="border-t border-brand-vanilla-dark dark:border-brand-green-700">
                    <td className="px-3 py-2 font-medium">{c.insumo_nombre}</td>
                    <td className="px-3 py-2 font-semibold text-red-600">
                      {formatCantidad(c.cantidad_unidades)} {c.unidad_medida}
                    </td>
                    <td className="px-3 py-2 text-brand-ink/80 dark:text-brand-vanilla/80">
                      {c.producto_nombre ? `${formatCantidad(c.cantidad_producto ?? "0")}× ${c.producto_nombre}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {c.mesa_numero ?? "—"}
                      {c.mesa_piso && (
                        <span className="text-brand-ink/60 dark:text-brand-vanilla/60"> ({labelArea(c.mesa_piso)})</span>
                      )}
                      {c.orden_nombre && (
                        <span className="ml-1 italic text-brand-ink/60 dark:text-brand-vanilla/60">
                          "{c.orden_nombre}"
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-brand-ink/70 dark:text-brand-vanilla/70">
                      {c.mesero_nombre ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-brand-ink/60 dark:text-brand-vanilla/60">
                      {formatearFechaHora(c.created_at)}
                    </td>
                  </tr>
                ));

                return [filaEncabezado, ...filasDelDia];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
