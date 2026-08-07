import { useState } from "react";
import { PanelParametros } from "./PanelParametros";
import { TablaCeras } from "./TablaCeras";
import { TablaFragancias } from "./TablaFragancias";
import { TablaInsumos } from "./TablaInsumos";
import { TablaPabilos } from "./TablaPabilos";

const SUBPESTANAS = [
  { valor: "ceras", label: "🕯️ Ceras" },
  { valor: "fragancias", label: "🌸 Fragancias" },
  { valor: "pabilos", label: "🧵 Pabilos" },
  { valor: "insumos", label: "📦 Insumos" },
  { valor: "parametros", label: "⚙️ Parámetros" },
] as const;
type Subpestana = (typeof SUBPESTANAS)[number]["valor"];

/** Tablas maestras editables — precio de compra entra, el valor por unidad
 *  de uso (gramo/cm) lo calcula la base sola (columna GENERATED). */
export function MaterialesTab() {
  const [activa, setActiva] = useState<Subpestana>("ceras");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 border-b border-brand-vanilla-dark pb-2 dark:border-brand-green-700">
        {SUBPESTANAS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setActiva(p.valor)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activa === p.valor
                ? "bg-brand-green-700 text-brand-vanilla"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/30"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {activa === "ceras" && <TablaCeras />}
      {activa === "fragancias" && <TablaFragancias />}
      {activa === "pabilos" && <TablaPabilos />}
      {activa === "insumos" && <TablaInsumos />}
      {activa === "parametros" && <PanelParametros />}
    </div>
  );
}
