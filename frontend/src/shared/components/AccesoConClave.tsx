import { useState, type FormEvent, type ReactNode } from "react";
import { CLAVE_ACCESO_RESTRINGIDO } from "../auth/claveAcceso";

/**
 * Bloquea el contenido hasta escribir la clave compartida (ver
 * claveAcceso.ts) — a diferencia de SumatoriasBloqueadas (Caja General),
 * que se vuelve a ocultar sola a los 40 s, este queda desbloqueado
 * mientras el componente siga montado: se vuelve a pedir solo si se sale
 * de la página y se entra de nuevo (el estado vive en este componente, no
 * se guarda en ningún lado).
 */
export function AccesoConClave({ children, mensaje = "Esta sección está protegida" }: { children: ReactNode; mensaje?: string }) {
  const [desbloqueado, setDesbloqueado] = useState(false);
  const [clave, setClave] = useState("");
  const [error, setError] = useState(false);

  if (desbloqueado) return <>{children}</>;

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (clave === CLAVE_ACCESO_RESTRINGIDO) {
      setDesbloqueado(true);
    } else {
      setError(true);
      setClave("");
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-brand-vanilla-dark p-6 text-sm dark:border-brand-green-700"
    >
      <span className="text-brand-ink/70 dark:text-brand-vanilla/70">🔒 {mensaje} — escribe la clave para continuar</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Clave de acceso"
        autoFocus
        value={clave}
        onChange={(e) => {
          setClave(e.target.value);
          setError(false);
        }}
        placeholder="Clave"
        className={`w-32 rounded-md border bg-brand-vanilla px-2 py-1.5 text-center text-brand-ink outline-none focus:border-brand-green-600 dark:bg-brand-green-900 dark:text-brand-vanilla ${
          error ? "border-red-500" : "border-brand-vanilla-dark dark:border-brand-green-700"
        }`}
      />
      <button
        type="submit"
        className="rounded-md bg-brand-green-700 px-4 py-1.5 text-xs font-medium text-brand-vanilla hover:bg-brand-green-600"
      >
        Entrar
      </button>
      {error && <span className="text-xs text-red-600">Clave incorrecta</span>}
    </form>
  );
}
