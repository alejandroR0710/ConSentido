import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { velasApi } from "../api";

/** Parámetros globales que usa la calculadora cuando una receta no trae los
 *  suyos propios (% merma, $/minuto mano de obra, % indirectos, % margen).
 *  Fila única en la base — siempre se actualiza, nunca se crea otra. */
export function PanelParametros() {
  const [porcentajeMerma, setPorcentajeMerma] = useState(0);
  const [valorMinutoManoObra, setValorMinutoManoObra] = useState(0);
  const [porcentajeIndirectos, setPorcentajeIndirectos] = useState(0);
  const [margenObjetivo, setMargenObjetivo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    velasApi
      .obtenerParametros()
      .then((p) => {
        setPorcentajeMerma(Number(p.porcentaje_merma));
        setValorMinutoManoObra(Number(p.valor_minuto_mano_obra));
        setPorcentajeIndirectos(Number(p.porcentaje_indirectos));
        setMargenObjetivo(Number(p.margen_objetivo));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar los parámetros"))
      .finally(() => setLoading(false));
  }, []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      await velasApi.actualizarParametros({
        porcentajeMerma,
        valorMinutoManoObra,
        porcentajeIndirectos,
        margenObjetivo,
      });
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
        Estos valores se aplican por defecto a toda receta que no traiga los suyos propios.
      </p>

      <div>
        <label className="mb-1 block text-xs font-medium">% Merma (desperdicio sobre el costo directo)</label>
        <input
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={porcentajeMerma || ""}
          onChange={(e) => setPorcentajeMerma(Number(e.target.value))}
          className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">Valor por minuto de mano de obra</label>
        <MoneyInput
          value={valorMinutoManoObra}
          onChange={setValorMinutoManoObra}
          className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">% Costos indirectos</label>
        <input
          type="number"
          min={0}
          max={100}
          step="0.1"
          value={porcentajeIndirectos || ""}
          onChange={(e) => setPorcentajeIndirectos(Number(e.target.value))}
          className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium">% Margen de utilidad objetivo</label>
        <input
          type="number"
          min={0}
          max={99}
          step="0.1"
          value={margenObjetivo || ""}
          onChange={(e) => setMargenObjetivo(Number(e.target.value))}
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
