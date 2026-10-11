import { useLocation, useNavigate } from "react-router-dom";
import { formatMoney } from "../format/money";
import { useCuentasMinimizadas } from "../cuentasMinimizadas/CuentasMinimizadasContext";
import { useIngresosMinimizados } from "../ingresosMinimizados/IngresosMinimizadosContext";

/**
 * Barra fija al pie de la pantalla, visible en toda la plataforma — mezcla
 * las cuentas de Migao minimizadas y los formularios de "Registrar ingreso"
 * de Caja General minimizados en una sola lista de chips. Cada Context es
 * independiente (ver CuentasMinimizadasContext.tsx / IngresosMinimizadosContext.tsx);
 * esta barra es el único punto donde se mezclan. Solo existe visualmente si
 * hay algo minimizado de cualquiera de los dos tipos.
 */
export function BarraMinimizados() {
  const { minimizadas: cuentas, restaurar: restaurarCuenta, descartar: descartarCuenta } = useCuentasMinimizadas();
  const { minimizados: ingresos, restaurar: restaurarIngreso, descartar: descartarIngreso } = useIngresosMinimizados();
  const navigate = useNavigate();
  const location = useLocation();

  if (cuentas.length === 0 && ingresos.length === 0) return null;

  function restaurarCuentaDesdeBarra(ordenId: string) {
    if (location.pathname !== "/migao") navigate("/migao");
    restaurarCuenta(ordenId);
  }

  function restaurarIngresoDesdeBarra(id: string, destino: string) {
    if (location.pathname !== destino) navigate(destino);
    restaurarIngreso(id);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 overflow-x-auto border-t border-brand-vanilla-dark bg-brand-vanilla p-2 dark:border-brand-green-700 dark:bg-brand-green-900">
      {cuentas.map((c) => (
        <div
          key={`cuenta-${c.ordenId}`}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() => restaurarCuentaDesdeBarra(c.ordenId)}
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {c.etiqueta} · {formatMoney(c.montoAproximado)}
          </button>
          <button
            onClick={() => descartarCuenta(c.ordenId)}
            aria-label={`Descartar ${c.etiqueta} minimizada`}
            title="Descartar sin restaurar"
            className="text-brand-ink/50 hover:text-red-600 dark:text-brand-vanilla/50"
          >
            ✕
          </button>
        </div>
      ))}
      {ingresos.map((i) => (
        <div
          key={`ingreso-${i.id}`}
          className="flex shrink-0 items-center gap-2 rounded-full border border-brand-green-600 bg-brand-green-50 px-3 py-1.5 text-sm dark:border-brand-green-500 dark:bg-brand-green-700/30"
        >
          <button
            onClick={() =>
              restaurarIngresoDesdeBarra(i.id, i.origen.tipo === "cotizacion" ? "/migao/cotizaciones" : "/caja")
            }
            className="font-medium text-brand-green-700 hover:underline dark:text-brand-vanilla"
          >
            ➖ {i.etiqueta} · {formatMoney(i.montoAproximado)}
          </button>
          <button
            onClick={() => descartarIngreso(i.id)}
            aria-label={`Descartar ${i.etiqueta} minimizado`}
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
