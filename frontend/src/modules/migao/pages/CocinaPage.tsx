import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { agruparPorOrden } from "../agruparTickets";
import { migaoApi, type ItemCocina } from "../api";
import { reproducirAlerta, reproducirNotificacionSuave } from "../beep";
import { formatCantidad } from "../format";

const REFRESCO_MS = 8000;
const MINUTOS_ALERTA = 12;
// Mientras una orden siga en espera (sin que Cocina la empiece a preparar), la
// alerta se repite cada este número de minutos en vez de sonar una sola vez.
const MINUTOS_REPETICION_ALERTA = 2;

function formatearHora(fechaIso: string) {
  return new Date(fechaIso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function CocinaPage() {
  const [items, setItems] = useState<ItemCocina[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  // null = todavía no hubo ninguna carga; evita el falso "pedido nuevo" del primer render.
  const idsConocidosRef = useRef<Set<number> | null>(null);
  // Última vez (epoch ms) que sonó la alerta de cada orden todavía en espera;
  // permite repetirla cada MINUTOS_REPETICION_ALERTA en vez de solo una vez, y
  // se olvida en cuanto la orden se empieza a preparar (deja de estar "en espera").
  const ultimaAlertaRef = useRef<Map<string, number>>(new Map());

  async function cargar() {
    try {
      const cola = await migaoApi.listarColaCocina();

      if (idsConocidosRef.current) {
        const hayPedidoNuevo = cola.some((item) => !idsConocidosRef.current!.has(item.id));
        if (hayPedidoNuevo) reproducirNotificacionSuave();
      }
      idsConocidosRef.current = new Set(cola.map((item) => item.id));

      const ahora = Date.now();
      for (const ticket of agruparPorOrden(cola)) {
        const pendientes = ticket.items.filter((i) => i.estado === "pendiente");
        if (pendientes.length === 0) {
          // Ya se empezó a preparar (o no tiene nada pendiente): deja de estar
          // "en espera", se olvida para que si vuelve a esperar algún día empiece de cero.
          ultimaAlertaRef.current.delete(ticket.ordenId);
          continue;
        }
        const inicioEspera = Math.min(...pendientes.map((i) => new Date(i.created_at).getTime()));
        const minutosEsperando = (ahora - inicioEspera) / 60000;
        if (minutosEsperando < MINUTOS_ALERTA) continue;

        const ultimaAlerta = ultimaAlertaRef.current.get(ticket.ordenId);
        if (ultimaAlerta === undefined || ahora - ultimaAlerta >= MINUTOS_REPETICION_ALERTA * 60000) {
          ultimaAlertaRef.current.set(ticket.ordenId, ahora);
          reproducirAlerta();
        }
      }

      setItems(cola);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la cola de cocina");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, []);

  const tickets = useMemo(() => agruparPorOrden(items), [items]);

  /** Aplica al estado local los ítems que el backend acaba de devolver ya
   *  actualizados, en vez de esperar el próximo poll o pedir de nuevo la cola
   *  completa — evita un viaje de red extra por acción, que es justo lo que se
   *  siente como demora en un plan gratuito de Render/Supabase.
   *  Merge superficial (no reemplazo completo): estas mutaciones devuelven las
   *  columnas crudas de orden_items (RETURNING *), sin los JOIN de producto/mesa/
   *  mesero que trae listItemsCocina — reemplazar el objeto entero los borraría. */
  function aplicarActualizacion(actualizados: ItemCocina[]) {
    setItems((actual) => {
      const porId = new Map(actualizados.map((i) => [i.id, i]));
      return actual.map((i) => {
        const nuevo = porId.get(i.id);
        return nuevo ? { ...i, ...nuevo } : i;
      });
    });
  }

  async function empezarPreparar(ordenId: string) {
    setProcesandoId(ordenId);
    try {
      const actualizados = await migaoApi.empezarPreparar(ordenId);
      aplicarActualizacion(actualizados);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo empezar a preparar la orden");
    } finally {
      setProcesandoId(null);
    }
  }

  async function toggleCheck(item: ItemCocina) {
    try {
      const actualizado = await migaoApi.marcarCheckItem(item.id, !item.listo_cocina);
      aplicarActualizacion([actualizado]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar el producto");
    }
  }

  async function marcarOrdenLista(ordenId: string) {
    setProcesandoId(ordenId);
    try {
      await migaoApi.marcarOrdenLista(ordenId);
      // Una orden lista sale de la cola de Cocina (el backend ya no la incluye en
      // listarColaCocina) — se quita local de una vez, sin esperar el próximo poll.
      setItems((actual) => actual.filter((i) => i.orden_id !== ordenId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar la orden como lista");
    } finally {
      setProcesandoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Cocina</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Un ticket por orden. "Empezar a preparar" mueve todo el ticket; el check es por producto. Se actualiza
          solo cada {REFRESCO_MS / 1000}s.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-brand-ink/60">Cargando...</p>
      ) : tickets.length === 0 ? (
        <p className="rounded-lg border border-brand-vanilla-dark p-8 text-center text-lg text-brand-ink/60 dark:border-brand-green-700">
          No hay pedidos pendientes. 🎉
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tickets.map((ticket) => {
            const pendientes = ticket.items.filter((i) => i.estado === "pendiente");
            const preparando = ticket.items.filter((i) => i.estado === "preparando");
            const puedeMarcarListo =
              preparando.length > 0 && pendientes.length === 0 && preparando.every((i) => i.listo_cocina);
            const procesando = procesandoId === ticket.ordenId;
            const inicioEspera =
              pendientes.length > 0 ? Math.min(...pendientes.map((i) => new Date(i.created_at).getTime())) : null;
            const minutosEsperando = inicioEspera !== null ? (Date.now() - inicioEspera) / 60000 : 0;
            const vencido = pendientes.length > 0 && minutosEsperando >= MINUTOS_ALERTA;

            return (
              <div
                key={ticket.ordenId}
                className={`flex flex-col gap-3 rounded-xl p-4 shadow-sm dark:bg-brand-green-900 ${
                  vencido
                    ? "animate-pulse border-4 border-orange-600 bg-orange-50 dark:border-orange-500"
                    : "border-2 border-brand-green-600 bg-brand-vanilla dark:border-brand-green-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-3xl font-extrabold text-brand-green-700 dark:text-brand-vanilla">
                    Mesa {ticket.mesaNumero}
                    {ticket.mesaPiso && <span className="text-lg font-semibold"> (piso {ticket.mesaPiso})</span>}
                    {vencido && (
                      <span className="rounded-full bg-orange-600 px-2 py-0.5 text-xs font-bold text-white">
                        +{MINUTOS_ALERTA} min
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                    {formatearHora(ticket.items[0].created_at)}
                  </span>
                </div>
                {ticket.meseroNombre && (
                  <div className="-mt-2 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
                    Mesero: {ticket.meseroNombre}
                  </div>
                )}

                {pendientes.length > 0 && (
                  <>
                    <ul className="flex flex-col gap-1">
                      {pendientes.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-lg font-semibold text-brand-ink dark:bg-amber-950/30 dark:text-brand-vanilla"
                        >
                          {formatCantidad(item.cantidad)}× {item.producto_nombre}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => empezarPreparar(ticket.ordenId)}
                      disabled={procesando}
                      className="w-full rounded-md bg-amber-500 px-4 py-3 text-lg font-bold text-white hover:bg-amber-600 disabled:opacity-60"
                    >
                      {procesando
                        ? "Procesando..."
                        : preparando.length > 0
                          ? `Empezar a preparar (${pendientes.length} nuevo${pendientes.length > 1 ? "s" : ""})`
                          : "Empezar a preparar"}
                    </button>
                  </>
                )}

                {preparando.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {preparando.map((item) => (
                      <li key={item.id}>
                        <button
                          onClick={() => toggleCheck(item)}
                          className={`flex min-h-16 w-full items-center gap-3 rounded-md border-2 px-3 py-3 text-left ${
                            item.listo_cocina
                              ? "border-brand-green-600 bg-brand-green-50 dark:bg-brand-green-700/30"
                              : "border-brand-vanilla-dark dark:border-brand-green-700"
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 text-xl ${
                              item.listo_cocina
                                ? "border-brand-green-600 bg-brand-green-600 text-brand-vanilla"
                                : "border-brand-ink/40 dark:border-brand-vanilla/40"
                            }`}
                          >
                            {item.listo_cocina ? "✓" : ""}
                          </span>
                          <span className="flex-1">
                            <span className="block text-lg font-semibold text-brand-ink dark:text-brand-vanilla">
                              {formatCantidad(item.cantidad)}× {item.producto_nombre}
                            </span>
                            {item.producto_descripcion && (
                              <span className="block text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                                {item.producto_descripcion}
                              </span>
                            )}
                            {item.observaciones && (
                              <span className="block text-sm font-semibold text-amber-700 dark:text-amber-400">
                                ⚠ {item.observaciones}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {preparando.length > 0 && (
                  <button
                    onClick={() => marcarOrdenLista(ticket.ordenId)}
                    disabled={!puedeMarcarListo || procesando}
                    className="w-full rounded-md bg-brand-green-700 px-4 py-3 text-lg font-bold text-brand-vanilla hover:bg-brand-green-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {puedeMarcarListo ? "Marcar orden lista" : "Falta marcar todos los productos"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
