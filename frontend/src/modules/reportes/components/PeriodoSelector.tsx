export type PeriodoTipo = "mes_actual" | "rango" | "historico";

export interface PeriodoValue {
  periodo: PeriodoTipo;
  desde: string;
  hasta: string;
}

function fechaISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// El Spec pide "todo el histórico", pero los 7 endpoints de Tasks 2-8 exigen
// `desde`/`hasta` por schema (ver reportes.schema.ts::reportesRangoSchema en
// el backend) — no soportan ausencia de filtro de fecha. Se resuelve a una
// fecha fija suficientemente antigua en vez de omitir el filtro.
const DESDE_HISTORICO = "2020-01-01";

/** Calcula desde/hasta para "Mes actual" (1 del mes en curso → hoy) y "Todo
 *  el histórico" (fecha fija → hoy). "Rango libre" no tiene cálculo propio:
 *  su valor viene directo de los `<input type="date">` que edita el usuario. */
function calcularPeriodo(periodo: "mes_actual" | "historico"): { desde: string; hasta: string } {
  const hoy = new Date();
  const hasta = fechaISO(hoy);
  if (periodo === "historico") return { desde: DESDE_HISTORICO, hasta };
  return { desde: fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta };
}

/** Valor inicial del selector para el estado de cada pestaña que lo consume
 *  (`ReportesPage` y, desde Tasks 11-17, cada reporte): arranca en "Mes
 *  actual", mismo criterio default que el brief de este Task. */
export function periodoInicial(): PeriodoValue {
  return { periodo: "mes_actual", ...calcularPeriodo("mes_actual") };
}

const OPCIONES: { valor: PeriodoTipo; etiqueta: string }[] = [
  { valor: "mes_actual", etiqueta: "Mes actual" },
  { valor: "rango", etiqueta: "Rango libre" },
  { valor: "historico", etiqueta: "Todo el histórico" },
];

interface PeriodoSelectorProps {
  value: PeriodoValue;
  onChange: (nuevoValor: PeriodoValue) => void;
}

/**
 * Selector de período compartido por las 7 pestañas de Reportes (Tasks
 * 11-17) — centraliza en un solo lugar la resolución de `desde`/`hasta` que
 * en los dashboards de analíticas existentes (InsumosAnalyticsSection.tsx/
 * TalleresAnalyticsSection.tsx) está duplicada por cada sección como
 * Día/Semana/Mes. Mismo patrón visual de pills que esos componentes, pero
 * el componente NO llama ninguna API — solo resuelve fechas; cada pestaña
 * usa el `desde`/`hasta` resultante para su propia llamada (ver brief Task
 * 10, misma separación de responsabilidades).
 *
 * Nota para las pestañas que agreguen su propio selector de semana (Tasks
 * 11-17, Spec): cuando el período activo no es "Mes actual" ni un "Rango
 * libre" de un solo mes, ese selector de semana debe deshabilitarse — ese
 * comportamiento vive en cada pestaña consumidora (tiene la info en
 * `value.periodo`/`value.desde`/`value.hasta`), no en este componente.
 */
export function PeriodoSelector({ value, onChange }: PeriodoSelectorProps) {
  function seleccionar(periodo: PeriodoTipo) {
    if (periodo === "rango") {
      // Al entrar a "Rango libre" se arranca con el desde/hasta que ya se
      // estaba mostrando (editable desde ahí), no en blanco.
      onChange({ periodo, desde: value.desde, hasta: value.hasta });
      return;
    }
    onChange({ periodo, ...calcularPeriodo(periodo) });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {OPCIONES.map((o) => (
          <button
            key={o.valor}
            onClick={() => seleccionar(o.valor)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              value.periodo === o.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>

      {value.periodo === "rango" && (
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={value.desde}
            max={value.hasta}
            onChange={(e) => onChange({ ...value, desde: e.target.value })}
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          />
          <span className="text-brand-ink/60 dark:text-brand-vanilla/60">a</span>
          <input
            type="date"
            value={value.hasta}
            min={value.desde}
            onChange={(e) => onChange({ ...value, hasta: e.target.value })}
            className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
          />
        </div>
      )}
    </div>
  );
}
