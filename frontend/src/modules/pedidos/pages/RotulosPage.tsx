import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { ModalImprimirRotulo } from "../../../shared/components/ModalImprimirRotulo";
import { pedidosApi, type Rotulo } from "../api";
import { NuevoRotuloModal } from "../components/NuevoRotuloModal";

function formatearFechaHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleString("es", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Rótulos de envío creados sueltos, sin pasar por un pedido completo —
 * botón "🏷️ Rótulos" en Pedidos/Encargos. `fuente` queda lista para
 * distinguir, a futuro, los que lleguen conectados del e-commerce (hoy
 * todos nacen 'manual' — ver pedidos.service.ts::crearRotulo).
 */
export function RotulosPage() {
  const [rotulos, setRotulos] = useState<Rotulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [imprimiendo, setImprimiendo] = useState<Rotulo | null>(null);

  async function cargar() {
    try {
      setRotulos(await pedidosApi.listarRotulos());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los rótulos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <BotonVolver to="/pedidos" />
          <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Rótulos</h1>
          <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
            Etiquetas de envío creadas sueltas, sin necesidad de armar un pedido completo.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600"
        >
          + Nuevo rótulo
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : rotulos.length === 0 ? (
        <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Sin rótulos creados todavía.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rotulos.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700"
            >
              <div className="min-w-0">
                <div className="font-medium text-brand-ink dark:text-brand-vanilla">{r.destinatario_nombre}</div>
                <div className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                  {r.descripcion}
                  {r.ciudad_envio && ` · ${r.ciudad_envio}`}
                </div>
                <div className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                  {formatearFechaHora(r.created_at)}
                  {r.creado_por_nombre && ` · ${r.creado_por_nombre}`}
                </div>
              </div>
              <button
                onClick={() => setImprimiendo(r)}
                className="shrink-0 rounded-md border border-brand-vanilla-dark px-3 py-1.5 text-sm text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
              >
                🏷️ Imprimir
              </button>
            </div>
          ))}
        </div>
      )}

      {modalAbierto && (
        <NuevoRotuloModal
          onCerrar={() => setModalAbierto(false)}
          onCreado={(rotulo) => {
            setRotulos((prev) => [rotulo, ...prev]);
            setModalAbierto(false);
            setImprimiendo(rotulo);
          }}
        />
      )}

      {imprimiendo && (
        <ModalImprimirRotulo
          onCerrar={() => setImprimiendo(null)}
          destinatarioNombre={imprimiendo.destinatario_nombre}
          destinatarioDocumento={imprimiendo.destinatario_documento}
          destinatarioTelefono={imprimiendo.destinatario_telefono}
          direccionEnvio={imprimiendo.direccion_envio}
          ciudadEnvio={imprimiendo.ciudad_envio}
          descripcion={imprimiendo.descripcion}
          fechaAlistado={imprimiendo.created_at}
          metodoEnvio={imprimiendo.metodo_envio}
          transportadora={imprimiendo.transportadora}
          numeroGuia={imprimiendo.numero_guia}
        />
      )}
    </div>
  );
}
