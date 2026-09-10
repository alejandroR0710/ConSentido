import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../../../shared/api/client";
import { tieneAccesoTotal } from "../../../shared/auth/roles";
import { useAuth } from "../../../shared/auth/useAuth";
import { BotonVolver } from "../../../shared/components/BotonVolver";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { formatMoney } from "../../../shared/format/money";
import { concretoApi, type CalculoConcreto } from "../api";

/** gramos con hasta 1 decimal, sin ceros de más ("540", "129,6"). */
function formatGramos(valor: number) {
  return `${Number(valor.toFixed(1)).toLocaleString("es-CO")} g`;
}

const REDONDEOS: { valor: 0 | 100 | 500 | 1000; label: string }[] = [
  { valor: 0, label: "Sin redondeo" },
  { valor: 100, label: "A $100" },
  { valor: 500, label: "A $500" },
  { valor: 1000, label: "A $1.000" },
];

const INPUT_CLASE =
  "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

/** Campo con su etiqueta arriba y la unidad de medida como sufijo gris a la
 *  derecha del input, para que se vea siempre qué representa cada número. */
function Campo({
  label,
  unidad,
  children,
}: {
  label: string;
  unidad: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1">{children}</div>
        <span className="shrink-0 text-xs font-medium text-brand-ink/50 dark:text-brand-vanilla/50">{unidad}</span>
      </div>
    </div>
  );
}

/**
 * Calculadora de precio de piezas de concreto — exclusiva de Root/Super Root.
 * Todo en una sola pantalla: peso de la pieza + precios/costos editables, con
 * el desglose y el precio de venta actualizándose en vivo. "Guardar precios"
 * fija esos valores como los de por defecto para la próxima vez. La receta
 * (40% cemento / 60% marmolina / 24% agua, factor de mezcla) es fija.
 */
export function CalculadoraConcretoPage() {
  const { usuario } = useAuth();
  const puedeVer = tieneAccesoTotal(usuario?.rol);

  const [pesoFinal, setPesoFinal] = useState(0);

  // Precios/costos editables — arrancan con lo guardado en la base.
  const [precioCementoGramo, setPrecioCementoGramo] = useState(2.125);
  const [precioMarmolinaGramo, setPrecioMarmolinaGramo] = useState(0.7975);
  const [costoAgua, setCostoAgua] = useState(400);
  const [costoPintura, setCostoPintura] = useState(400);
  const [costoSellante, setCostoSellante] = useState(200);
  const [costoLija, setCostoLija] = useState(100);
  const [costoManoObra, setCostoManoObra] = useState(3000);
  const [multiplicadorPrecio, setMultiplicadorPrecio] = useState(3);
  const [redondeo, setRedondeo] = useState<0 | 100 | 500 | 1000>(100);

  const [resultado, setResultado] = useState<CalculoConcreto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensajeGuardado, setMensajeGuardado] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parametros = {
    precioCementoGramo,
    precioMarmolinaGramo,
    costoAgua,
    costoPintura,
    costoSellante,
    costoLija,
    costoManoObra,
    multiplicadorPrecio,
    redondeo,
  };

  // Carga los precios guardados una vez.
  useEffect(() => {
    concretoApi
      .obtenerParametros()
      .then((p) => {
        setPrecioCementoGramo(Number(p.precio_cemento_gramo));
        setPrecioMarmolinaGramo(Number(p.precio_marmolina_gramo));
        setCostoAgua(Number(p.costo_agua));
        setCostoPintura(Number(p.costo_pintura));
        setCostoSellante(Number(p.costo_sellante));
        setCostoLija(Number(p.costo_lija));
        setCostoManoObra(Number(p.costo_mano_obra));
        setMultiplicadorPrecio(Number(p.multiplicador_precio));
        setRedondeo(Number(p.redondeo) as 0 | 100 | 500 | 1000);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los precios"));
  }, []);

  // Recalcula en vivo cuando cambia el peso o cualquier precio/costo.
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
        setResultado(await concretoApi.calcular({ pesoFinalG: pesoFinal, ...parametros }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo calcular");
        setResultado(null);
      } finally {
        setCalculando(false);
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pesoFinal,
    precioCementoGramo,
    precioMarmolinaGramo,
    costoAgua,
    costoPintura,
    costoSellante,
    costoLija,
    costoManoObra,
    multiplicadorPrecio,
    redondeo,
  ]);

  async function guardarPrecios() {
    setGuardando(true);
    setMensajeGuardado(null);
    setError(null);
    try {
      await concretoApi.actualizarParametros(parametros);
      setMensajeGuardado("Precios guardados como valores por defecto.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar los precios");
    } finally {
      setGuardando(false);
    }
  }

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
        {
          label: "Costos adicionales (agua, pintura, sellante, lija, mano de obra)",
          valor: formatMoney(resultado.costosAdicionales),
        },
        { label: "Costo total de producción", valor: formatMoney(resultado.costoTotal), fuerte: true },
        {
          label: `Precio de venta (× ${resultado.multiplicadorAplicado})`,
          valor: formatMoney(resultado.precioVenta),
          fuerte: true,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BotonVolver to="/con-sentido" />
        <h1 className="text-xl font-semibold text-brand-green-700 dark:text-brand-vanilla">Precio de Concreto</h1>
        <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
          Pesa la pieza terminada, ingresa ese peso y el sistema calcula cuánto costó producirla y su precio de venta.
          La receta es fija (40% cemento blanco, 60% marmolina, 24% agua, factor de mezcla 1,8); los precios de abajo se
          ajustan cuando cambien.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Formulario único */}
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border-2 border-brand-green-600 p-4 dark:border-brand-green-500">
            <Campo label="Peso final de la pieza" unidad="g">
              <NumeroInput
                value={pesoFinal}
                onChange={setPesoFinal}
                autoFocus
                placeholder="Ej. 549"
                className={`${INPUT_CLASE} text-lg font-semibold`}
              />
            </Campo>
          </div>

          <div className="flex flex-col gap-4 rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
              Precios y costos
            </p>
            <Campo label="Precio cemento blanco" unidad="$/g">
              <NumeroInput value={precioCementoGramo} onChange={setPrecioCementoGramo} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Precio marmolina" unidad="$/g">
              <NumeroInput value={precioMarmolinaGramo} onChange={setPrecioMarmolinaGramo} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Agua" unidad="$/pieza">
              <MoneyInput value={costoAgua} onChange={setCostoAgua} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Pintura acrílica" unidad="$/pieza">
              <MoneyInput value={costoPintura} onChange={setCostoPintura} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Sellante" unidad="$/pieza">
              <MoneyInput value={costoSellante} onChange={setCostoSellante} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Lija" unidad="$/pieza">
              <MoneyInput value={costoLija} onChange={setCostoLija} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Mano de obra" unidad="$/pieza">
              <MoneyInput value={costoManoObra} onChange={setCostoManoObra} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Multiplicador de precio de venta" unidad="×">
              <NumeroInput value={multiplicadorPrecio} onChange={setMultiplicadorPrecio} className={INPUT_CLASE} />
            </Campo>
            <Campo label="Redondeo del precio de venta" unidad="$">
              <select
                value={redondeo}
                onChange={(e) => setRedondeo(Number(e.target.value) as 0 | 100 | 500 | 1000)}
                className={INPUT_CLASE}
              >
                {REDONDEOS.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="flex items-center gap-3">
              <button
                onClick={guardarPrecios}
                disabled={guardando}
                className="w-fit rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
              >
                {guardando ? "Guardando..." : "Guardar precios"}
              </button>
              {mensajeGuardado && (
                <span className="text-xs text-brand-green-700 dark:text-brand-vanilla">{mensajeGuardado}</span>
              )}
            </div>
          </div>
        </div>

        {/* Resultado en vivo */}
        <div className="flex flex-col gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {resultado ? (
            <div className="overflow-hidden rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
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
          ) : (
            <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
              Ingresa el peso de la pieza terminada para ver el cálculo.
            </p>
          )}

          {calculando && <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">Calculando...</p>}
        </div>
      </div>
    </div>
  );
}
