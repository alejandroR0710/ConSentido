import { Link } from "react-router-dom";

/** Flecha para volver al módulo desde su vista de historial — ahora que los
 *  historiales ya no viven en el sidebar (se abren desde un botón dentro del
 *  módulo), hace falta una forma explícita de regresar. */
export function BotonVolver({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-1 inline-flex w-fit items-center gap-1 text-sm text-brand-ink/60 hover:text-brand-green-700 dark:text-brand-vanilla/60 dark:hover:text-brand-vanilla"
    >
      ← Volver
    </Link>
  );
}
