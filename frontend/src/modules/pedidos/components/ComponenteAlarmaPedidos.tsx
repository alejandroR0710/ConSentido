import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { reproducirAlerta } from "../../migao/beep";
import { pedidosApi, type Pedido } from "../api";

const POLL_MS = 60000;

/**
 * Vive montado en el layout general (ver AppShell.tsx), solo para Root/Super
 * Root. Consulta cada minuto si hay pedidos vencidos (mismo intervalo que el
 * scheduler del backend, que reprograma `proxima_alarma_en` cada vez que
 * avisa) — si hay alguno, suena la alerta y muestra la ventana. Si se
 * cierra sin cambiar el estado del pedido, vuelve a aparecer en el
 * siguiente ciclo porque el pedido sigue contando como "vencido".
 */
export function ComponenteAlarmaPedidos() {
  const [vencidos, setVencidos] = useState<Pedido[]>([]);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function revisar() {
      try {
        const resultado = await pedidosApi.listar({ vencidos: true });
        if (cancelado) return;
        if (resultado.length > 0) {
          reproducirAlerta();
          setCerrado(false);
        }
        setVencidos(resultado);
      } catch {
        /* no bloquear la app si falla el chequeo — se reintenta en el próximo ciclo */
      }
    }
    revisar();
    const intervalo = setInterval(revisar, POLL_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  if (vencidos.length === 0 || cerrado) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-brand-green-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-red-600">⚠ Pedidos estancados</h2>
          <button onClick={() => setCerrado(true)} className="text-xl text-brand-ink/60 hover:text-brand-ink dark:text-brand-vanilla/60">
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {vencidos.map((p) => (
            <li key={p.id} className="rounded-md border border-brand-vanilla-dark p-2 dark:border-brand-green-700">
              <Link to={`/pedidos/${p.id}`} onClick={() => setCerrado(true)} className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla">
                {p.descripcion}
              </Link>
              <p className="text-xs capitalize text-brand-ink/60 dark:text-brand-vanilla/60">
                {p.estado} — {p.destinatario_nombre ?? "sin destinatario"}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          Esta alerta vuelve a aparecer hasta que cambies el estado de cada pedido.
        </p>
      </div>
    </div>
  );
}
