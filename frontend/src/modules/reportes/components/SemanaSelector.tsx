import { obtenerOpcionesSemana } from "../semana";

interface SemanaSelectorProps {
  desde: string;
  hasta: string;
  value: string;
  onChange: (value: string) => void;
  incluirSemanaIso?: boolean;
}

/** Filtro semanal disponible solo para períodos contenidos en un mismo mes. */
export function SemanaSelector({
  desde,
  hasta,
  value,
  onChange,
  incluirSemanaIso = false,
}: SemanaSelectorProps) {
  const opciones = obtenerOpcionesSemana(desde, hasta, incluirSemanaIso);
  if (!opciones.length) return null;

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">Semana</span>
      <select
        value={opciones.some((opcion) => opcion.value === value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-brand-vanilla-dark bg-transparent px-2 py-1.5 text-brand-ink dark:border-brand-green-700 dark:text-brand-vanilla"
      >
        <option value="">Todo el período</option>
        <optgroup label="Semana del mes">
          {opciones
            .filter((opcion) => opcion.grupo === "mes")
            .map((opcion) => (
              <option key={opcion.value} value={opcion.value}>
                {opcion.label}
              </option>
            ))}
        </optgroup>
        {incluirSemanaIso && (
          <optgroup label="Semana ISO">
            {opciones
              .filter((opcion) => opcion.grupo === "iso")
              .map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}