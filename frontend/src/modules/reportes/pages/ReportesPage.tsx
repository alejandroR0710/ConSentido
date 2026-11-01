import { useState } from "react";
import { CierreCajaTab } from "../components/CierreCajaTab";
import { GastosTab } from "../components/GastosTab";
import { PeriodoSelector, periodoInicial, type PeriodoValue } from "../components/PeriodoSelector";
import { ResumenTab } from "../components/ResumenTab";
import { VentasPorTipoTab } from "../components/VentasPorTipoTab";
import { VentasTab } from "../components/VentasTab";

type Pestana = "resumen" | "ventas" | "ventas-por-tipo" | "gastos" | "cierre-caja" | "prestamos" | "conciliacion";

// Pestañas que NO usan el `desde`/`hasta` del `PeriodoSelector` compartido de
// abajo — "cierre-caja" (Task 15) filtra por `mes` (YYYY-MM) con su propio
// `<input type="month">` interno (ver doc de `CierreCajaTab.tsx`); mostrar el
// selector compartido ahí no tendría ningún efecto sobre lo que esa pestaña
// renderiza, así que se oculta en vez de dejarlo como control muerto.
// "prestamos" (Task 17, Spec) tampoco tiene rango obligatorio
// (`reportesApi.obtenerPrestamos` solo acepta `destinatarioUsuarioId`) — su
// implementador probablemente deba agregarse acá también, mismo criterio.
const PESTANAS_SIN_PERIODO_COMPARTIDO: Pestana[] = ["cierre-caja"];

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "ventas", label: "Ventas" },
  { id: "ventas-por-tipo", label: "Ventas por tipo" },
  { id: "gastos", label: "Gastos" },
  { id: "cierre-caja", label: "Cierre de caja" },
  { id: "prestamos", label: "Préstamos" },
  { id: "conciliacion", label: "Conciliación" },
];

// Placeholder temporal de cada pestaña restante hasta que Tasks 16-17
// agreguen el componente real (una línea por pestaña se reemplaza con el
// import real, sin tocar el resto de este archivo — "resumen"/"ventas"/
// "ventas-por-tipo"/"gastos"/"cierre-caja" ya se reemplazaron así en Tasks
// 11-15, ver `ResumenTab`/`VentasTab`/`VentasPorTipoTab`/`GastosTab`/
// `CierreCajaTab`).
function PlaceholderReporte({ titulo }: { titulo: string }) {
  return (
    <div className="rounded-lg border border-dashed border-brand-vanilla-dark p-8 text-center dark:border-brand-green-700">
      <p className="text-brand-ink/60 dark:text-brand-vanilla/60">{titulo}: Próximamente</p>
    </div>
  );
}

/**
 * Contenedor de pestañas del módulo Reportes (Task 10 — scaffolding puro).
 * Un `PeriodoSelector` compartido arriba resuelve `desde`/`hasta` una sola
 * vez; cada pestaña (Tasks 11-17) lo toma y hace su propia llamada a
 * `reportesApi` con esos valores — este contenedor no llama ninguna API.
 * "Resumen" (Task 11), "Ventas" (Task 12), "Ventas por tipo" (Task 13) y
 * "Gastos" (Task 14) ya siguen ese patrón.
 *
 * "Cierre de caja" (Task 15) es la excepción: filtra por `mes`, no por
 * `desde`/`hasta`, así que administra su propio selector en vez de leer
 * `periodo` de acá — el `PeriodoSelector` compartido se oculta mientras esa
 * pestaña está activa (ver `PESTANAS_SIN_PERIODO_COMPARTIDO` arriba).
 */
export function ReportesPage() {
  const [pestanaActual, setPestanaActual] = useState<Pestana>("resumen");
  const [periodo, setPeriodo] = useState<PeriodoValue>(periodoInicial());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">Reportes</h2>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Reportes financieros y operativos de todo el negocio.
        </p>
      </div>

      {!PESTANAS_SIN_PERIODO_COMPARTIDO.includes(pestanaActual) && (
        <PeriodoSelector value={periodo} onChange={setPeriodo} />
      )}

      <div className="flex overflow-x-auto gap-2 pb-2">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPestanaActual(p.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
              pestanaActual === p.id
                ? "bg-brand-green-600 text-white"
                : "bg-brand-green-50 text-brand-green-700 hover:bg-brand-green-100 dark:bg-brand-green-700/30 dark:text-brand-vanilla dark:hover:bg-brand-green-700/50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {pestanaActual === "resumen" && <ResumenTab desde={periodo.desde} hasta={periodo.hasta} />}
        {pestanaActual === "ventas" && <VentasTab desde={periodo.desde} hasta={periodo.hasta} />}
        {pestanaActual === "ventas-por-tipo" && (
          <VentasPorTipoTab desde={periodo.desde} hasta={periodo.hasta} />
        )}
        {pestanaActual === "gastos" && <GastosTab desde={periodo.desde} hasta={periodo.hasta} />}
        {pestanaActual === "cierre-caja" && <CierreCajaTab />}
        {pestanaActual === "prestamos" && <PlaceholderReporte titulo="Préstamos" />}
        {pestanaActual === "conciliacion" && <PlaceholderReporte titulo="Conciliación" />}
      </div>
    </div>
  );
}
