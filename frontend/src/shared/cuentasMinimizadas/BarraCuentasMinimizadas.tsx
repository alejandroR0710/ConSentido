import { useLocation, useNavigate } from "react-router-dom";
import { formatMoney } from "../format/money";
import { useCuentasMinimizadas } from "./CuentasMinimizadasContext";

/**
 * Barra fija al pie de la pantalla, visible en toda la plataforma (no solo en
 * /migao) — ver AppShell.tsx. Solo existe visualmente si hay algo minimizado.
 */
export function BarraCuentasMinimizadas() {
  const { minimizadas, restaurar, descartar } = useCuentasMinimizadas();
  const navigate = useNavigate();
  const location = useLocation();

  if (minimizadas.length === 0) return null;

  function restaurarDesdeBarra(ordenId: string) {
    if (location.pathname !== "/migao") {
      navigate("/migao");
    }
    restaurar(ordenId);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 overflow-x-auto border-t border-brand-vanilla-dark bg-brand-vanilla p-2 dark:border-brand-green-700 dark:bg-brand-green-900">
      {minimizadas.map((c) => (
        <div
          key={c.ordenId}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() => restaurarDesdeBarra(c.ordenId)}
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {c.etiqueta} · {formatMoney(c.montoAproximado)}
          </button>
          <button
            onClick={() => descartar(c.ordenId)}
            aria-label={`Descartar ${c.etiqueta} minimizada`}
            title="Descartar sin restaurar"
            className="text-brand-ink/50 hover:text-red-600 dark:text-brand-vanilla/50"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
