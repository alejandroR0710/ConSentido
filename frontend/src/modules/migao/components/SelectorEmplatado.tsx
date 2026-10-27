import { useEffect, useState } from "react";
import { recetarioApi, type EmplatadoConReceta } from "../../recetario/api";

interface SelectorEmplatadoProps {
  value: string | null;
  onChange: (emplatadoId: string | null) => void;
}

/** Qué presentación de emplatado de qué receta corresponde a este producto
 *  (ver recetario_emplatados) — mismo plato, distinta forma de servirlo.
 *  Opcional: la mayoría de productos no necesita ninguna. */
export function SelectorEmplatado({ value, onChange }: SelectorEmplatadoProps) {
  const [opciones, setOpciones] = useState<EmplatadoConReceta[]>([]);

  useEffect(() => {
    recetarioApi.listarTodosEmplatados().then(setOpciones).catch(() => {
      /* el selector simplemente queda vacío si no se pudo cargar */
    });
  }, []);

  const porReceta = new Map<string, EmplatadoConReceta[]>();
  for (const o of opciones) {
    const lista = porReceta.get(o.receta_titulo) ?? [];
    lista.push(o);
    porReceta.set(o.receta_titulo, lista);
  }

  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium">Receta y presentación de emplatado (opcional)</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="">Sin receta asignada</option>
        {[...porReceta.entries()].map(([recetaTitulo, lista]) => (
          <optgroup key={recetaTitulo} label={recetaTitulo}>
            {lista.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
