import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { velasApi } from "../api";

/** Multiplicador global que usa la calculadora cuando una receta no trae el
 *  suyo propio: precio = (cera+fragancia+pabilo+mano de obra) × multiplicador
 *  + empaque. Fila única en la base — siempre se actualiza, nunca se crea otra. */
export function PanelParametros() {
  const [multiplicadorPrecio, setMultiplicadorPrecio] = useState(4);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    velasApi
      .obtenerParametros()
      .then((p) => setMultiplicadorPrecio(Number(p.multiplicador_precio)))
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar los parámetros"))
      .finally(() => setLoading(false));
  }, []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      await velasApi.actualizarParametros({ multiplicadorPrecio });
      setMensaje("Parámetros guardados.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-sm text-brand-ink/60">Cargando...</p>;

  return (
    <div className="flex max-w-md flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        Precio sugerido = (cera + fragancia + pabilo + mano de obra) × multiplicador, más el empaque aparte. Este
        multiplicador se aplica por defecto a toda receta que no traiga el suyo propio.
      </p>

      <div>
        <label className="mb-1 block text-xs font-medium">Multiplicador de precio</label>
        <input
          type="number"
          min={0}
          step="0.1"
          value={multiplicadorPrecio || ""}
          onChange={(e) => setMultiplicadorPrecio(Number(e.target.value))}
          className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar parámetros"}
      </button>
    </div>
  );
}
