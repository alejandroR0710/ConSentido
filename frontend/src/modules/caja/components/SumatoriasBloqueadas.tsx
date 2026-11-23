import { useEffect, useState, type FormEvent } from "react";
import { CLAVE_ACCESO_RESTRINGIDO } from "../../../shared/auth/claveAcceso";

// Las sumatorias de Caja quedan contraídas para Root/Super Root y se ven
// 40 s tras escribir la clave compartida.
const SEGUNDOS_VISIBLE = 40;

/** Desbloqueo temporal compartido por todas las sumatorias de la pantalla. */
export function useSumatoriasBloqueadas(activo: boolean) {
  const [hasta, setHasta] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    if (hasta === null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setAhora(n);
      if (n >= hasta) setHasta(null);
    }, 1000);
    return () => clearInterval(t);
  }, [hasta]);

  const desbloqueado = !activo || (hasta !== null && ahora < hasta);
  return {
    bloqueado: !desbloqueado,
    segundosRestantes: hasta === null ? 0 : Math.max(0, Math.ceil((hasta - ahora) / 1000)),
    mostrarTemporizador: activo && desbloqueado,
    intentar(clave: string) {
      if (clave !== CLAVE_ACCESO_RESTRINGIDO) return false;
      const n = Date.now();
      setAhora(n);
      setHasta(n + SEGUNDOS_VISIBLE * 1000);
      return true;
    },
    ocultar: () => setHasta(null),
  };
}

type Control = ReturnType<typeof useSumatoriasBloqueadas>;

/** Franja contraída que pide la clave; si `compacto`, un botón chico que abre el campo. */
export function SumatoriasBloqueadas({ control, compacto = false }: { control: Control; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(!compacto);
  const [clave, setClave] = useState("");
  const [error, setError] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (control.intentar(clave)) {
      setClave("");
      setError(false);
      if (compacto) setAbierto(false);
    } else {
      setError(true);
      setClave("");
    }
  }

  if (compacto && !abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
      >
        🔒 Ver totales
      </button>
    );
  }

  return (
    <form
      onSubmit={enviar}
      className={
        compacto
          ? "flex items-center gap-2"
          : "flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed border-brand-vanilla-dark p-3 text-sm dark:border-brand-green-700"
      }
    >
      {!compacto && (
        <span className="text-brand-ink/70 dark:text-brand-vanilla/70">🔒 Sumatorias ocultas — escribe la clave para verlas</span>
      )}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Clave para ver las sumatorias"
        autoFocus={compacto}
        value={clave}
        onChange={(e) => {
          setClave(e.target.value);
          setError(false);
        }}
        placeholder="Clave"
        className={`w-24 rounded-md border bg-brand-vanilla px-2 py-1 text-center text-brand-ink outline-none focus:border-brand-green-600 dark:bg-brand-green-900 dark:text-brand-vanilla ${
          error ? "border-red-500" : "border-brand-vanilla-dark dark:border-brand-green-700"
        }`}
      />
      <button
        type="submit"
        className="rounded-md bg-brand-green-700 px-3 py-1 text-xs font-medium text-brand-vanilla hover:bg-brand-green-600"
      >
        Ver
      </button>
      {compacto && (
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-xs text-brand-ink/60 hover:underline dark:text-brand-vanilla/60"
        >
          Cancelar
        </button>
      )}
      {error && <span className="text-xs text-red-600">Clave incorrecta</span>}
    </form>
  );
}

/** Aviso mientras están visibles: cuánto falta y botón para ocultarlas ya. */
export function TemporizadorSumatorias({ control }: { control: Control }) {
  if (!control.mostrarTemporizador) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
      <span>🔓 Visibles {control.segundosRestantes} s más</span>
      <button type="button" onClick={control.ocultar} className="underline hover:text-brand-green-700">
        Ocultar ya
      </button>
    </div>
  );
}
