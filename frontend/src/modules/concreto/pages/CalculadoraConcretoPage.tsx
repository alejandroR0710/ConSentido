import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { formatMoney } from "../../../shared/format/money";
import { concretoApi, type CalculoConcreto } from "../api";
import { PanelParametrosConcreto } from "../components/PanelParametrosConcreto";

/** gramos con hasta 1 decimal, sin ceros de más ("540", "129,6"). */
function formatGramos(valor: number) {
  return `${Number(valor.toFixed(1)).toLocaleString("es-CO")} g`;
}

/**
 * Calculadora de precio de piezas de concreto — exclusiva de Root/Super Root,
 * misma lógica que la de velas: se pesa la pieza terminada, se ingresa SOLO
 * ese peso y el sistema devuelve el desglose de material, el costo de
 * producción y el precio de venta. Los precios viven en la pestaña
 * "Materiales", editables sin tocar código; la receta (40/60/24) es fija.
 */
export function CalculadoraConcretoPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);
  const [tab, setTab] = useState<"calculadora" | "materiales">("calculadora");

  const [pesoFinal, setPesoFinal] = useState(0);
  const [resultado, setResultado] = useState<CalculoConcreto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  // Sube cuando se guardan parámetros nuevos, para volver a pedir el cálculo.
  const [versionParametros, setVersionParametros] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pesoFinal <= 0) {
      setResultado(null);
      setError(null);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setCalculando(true);
      setError(null);
      try {
        setResultado(await concretoApi.calcular(pesoFinal));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo calcular");
        setResultado(null);
      } finally {
        setCalculando(false);
      }
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [pesoFinal, versionParametros]);

  if (!puedeVer) {
    return <Navigate to="/con-sentido" replace />;
  }

  const filas: { label: string; valor: string; fuerte?: boolean }[] = resultado
    ? [
        { label: "Peso final de la pieza", valor: formatGramos(resultado.pesoFinalG) },
        { label: "Base de mezcla", valor: formatGramos(resultado.baseMezclaG) },
        { label: "Cemento blanco (40%)", valor: formatGramos(resultado.cementoG) },
        { label: "Marmolina (60%)", valor: formatGramos(resultado.marmolinaG) },
        { label: "Agua (24%)", valor: formatGramos(resultado.aguaG) },
        { label: "Costo cemento", valor: formatMoney(resultado.costoCemento) },
        { label: "Costo marmolina", valor: formatMoney(resultado.costoMarmolina) },
        { label: "Costos adicionales (agua, pintura, sellante, lija, mano de obra)", valor: formatMoney(resultado.costosAdicionales) },
        { label: "Costo total de producción", valor: formatMoney(resultado.costoTotal), fuerte: true },
        { label: `Precio de venta (× ${resultado.multiplicadorAplicado})`, valor: formatMoney(resultado.precioVenta), fuerte: true },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/con-sentido" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Precio de Concreto</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Pesa la pieza terminada, ingresa ese peso y el sistema calcula cuánto costó producirla y su precio de venta.
        </p>
      </div>

      <div className="flex gap-2 border-b-2 border-brand-vanilla-dark dark:border-brand-green-700">
        <button
          onClick={() => setTab("calculadora")}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "calculadora"
              ? "border-b-2 border-brand-green-700 text-brand-green-700 dark:text-brand-vanilla"
              : "text-brand-ink/60 dark:text-brand-vanilla/60"
          }`}
        >
          Calculadora
        </button>
        <button
          onClick={() => setTab("materiales")}
          className={`px-4 py-2 text-sm font-semibold ${
            tab === "materiales"
              ? "border-b-2 border-brand-green-700 text-brand-green-700 dark:text-brand-vanilla"
              : "text-brand-ink/60 dark:text-brand-vanilla/60"
          }`}
        >
          Materiales
        </button>
      </div>

      {tab === "materiales" ? (
        <PanelParametrosConcreto onGuardado={() => setVersionParametros((v) => v + 1)} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium">Peso final de la pieza (gramos)</label>
            <NumeroInput
              value={pesoFinal}
              onChange={setPesoFinal}
              autoFocus
              placeholder="Ej. 549"
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-lg font-semibold text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {resultado && (
            <div className="max-w-xl overflow-hidden rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
              <table className="w-full text-left text-sm">
                <tbody>
                  {filas.map((f) => (
                    <tr
                      key={f.label}
                      className={`border-t border-brand-vanilla-dark first:border-t-0 dark:border-brand-green-700 ${
                        f.fuerte ? "bg-brand-green-50 dark:bg-brand-green-700/20" : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-brand-ink/80 dark:text-brand-vanilla/80">{f.label}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          f.fuerte
                            ? "text-base font-bold text-brand-green-700 dark:text-brand-vanilla"
                            : "font-medium text-brand-ink dark:text-brand-vanilla"
                        }`}
                      >
                        {f.valor}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {calculando && <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">Calculando...</p>}
          {!resultado && !error && pesoFinal <= 0 && (
            <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
              Ingresa el peso de la pieza terminada para ver el cálculo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
