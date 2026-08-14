import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useRegistrarRefresco } from "../../../shared/refresh/RefrescoContext";
import { migaoApi } from "../api";

const POLL_MS = 15000;

interface EstadoAmasijo {
  id: number;
  nombre: string;
  comprado: number;
  usado: number;
  vendido: number;
  disponible: number;
}

interface EstadoBase {
  id: number;
  nombre: string;
  preparados: number;
  vendidos: number;
  disponibles: number;
}

interface Recomendacion {
  baseTipo: string;
  cantidadRecomendada: number;
  limitantes: Array<{
    amasijoTipo: string;
    disponible: number;
    necesario: number;
    botellaCuello: boolean;
  }>;
}

export function AmasijosPage() {
  const [amasijos, setAmasijos] = useState<EstadoAmasijo[]>([]);
  const [bases, setBases] = useState<EstadoBase[]>([]);
  const [recomendaciones, setRecomendaciones] = useState<Recomendacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    try {
      const [amasijosData, basesData, recomendacionesData] = await Promise.all([
        migaoApi.obtenerEstadoAmasijos(),
        migaoApi.obtenerEstadoBasesPrepаradas(),
        migaoApi.obtenerRecomendacionesPreparacion(),
      ]);

      setAmasijos(amasijosData);
      setBases(basesData);
      setRecomendaciones(recomendacionesData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, POLL_MS);
    return () => clearInterval(intervalo);
  }, []);

  useRegistrarRefresco(cargar);

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Amasijos y Bases</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Control de inventario de amasijos completos y recomendaciones para preparar bases de Migao.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-center text-brand-ink/60 dark:text-brand-vanilla/60">Cargando...</p>
      ) : (
        <>
          {/* Panel de Recomendaciones */}
          <div className="rounded-lg border border-brand-vanilla-dark bg-white p-6 dark:border-brand-green-700 dark:bg-brand-green-900/40">
            <h2 className="mb-4 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Recomendación de Preparación
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {recomendaciones.map((rec) => (
                <div
                  key={rec.baseTipo}
                  className={`rounded-md border-2 p-4 ${
                    rec.cantidadRecomendada > 0
                      ? "border-brand-green-300 bg-brand-green-50 dark:border-brand-green-600 dark:bg-brand-green-900/50"
                      : "border-red-300 bg-red-50 dark:border-red-600 dark:bg-red-900/50"
                  }`}
                >
                  <p className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">{rec.baseTipo}</p>
                  <p className="mt-2 text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">
                    {rec.cantidadRecomendada}
                  </p>
                  <p className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">bases recomendadas</p>

                  {rec.limitantes.length > 0 && (
                    <div className="mt-3 border-t border-current border-opacity-20 pt-3">
                      <p className="text-xs font-semibold text-brand-ink/60 dark:text-brand-vanilla/60">
                        Limitante:
                      </p>
                      {rec.limitantes.map((lim) => (
                        <p key={lim.amasijoTipo} className="text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                          {lim.amasijoTipo}: {lim.disponible.toFixed(1)} disponible
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Estado de Amasijos */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Inventario de Amasijos Completos
            </h2>
            <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                  <tr>
                    <th className="px-4 py-3">Amasijo</th>
                    <th className="px-4 py-3 text-right">Comprado</th>
                    <th className="px-4 py-3 text-right">Usado</th>
                    <th className="px-4 py-3 text-right">Vendido</th>
                    <th className="px-4 py-3 text-right">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {amasijos.map((amasijo) => (
                    <tr
                      key={amasijo.id}
                      className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                        amasijo.disponible === 0 ? "bg-red-50 dark:bg-red-950/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">{amasijo.nombre}</td>
                      <td className="px-4 py-3 text-right">{amasijo.comprado}</td>
                      <td className="px-4 py-3 text-right text-orange-600">{amasijo.usado}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{amasijo.vendido}</td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          amasijo.disponible === 0 ? "text-red-600" : "text-brand-green-600"
                        }`}
                      >
                        {amasijo.disponible}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Estado de Bases Preparadas */}
          <div>
            <h2 className="mb-4 text-lg font-semibold text-brand-green-700 dark:text-brand-vanilla">
              Bases Preparadas
            </h2>
            <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
                  <tr>
                    <th className="px-4 py-3">Base</th>
                    <th className="px-4 py-3 text-right">Preparadas</th>
                    <th className="px-4 py-3 text-right">Vendidas</th>
                    <th className="px-4 py-3 text-right">Disponibles</th>
                  </tr>
                </thead>
                <tbody>
                  {bases.map((base) => (
                    <tr
                      key={base.id}
                      className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${
                        base.disponibles === 0 ? "bg-red-50 dark:bg-red-950/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">{base.nombre}</td>
                      <td className="px-4 py-3 text-right">{base.preparados}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{base.vendidos}</td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          base.disponibles === 0 ? "text-red-600" : "text-brand-green-600"
                        }`}
                      >
                        {base.disponibles}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
