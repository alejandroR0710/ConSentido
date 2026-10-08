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

let siguienteKeyEmpaque = 1;
interface LineaEmpaqueForm {
  key: number;
  nombre: string;
  cantidad: number;
  valorUnitario: number;
}

function lineaEmpaqueVacia(): LineaEmpaqueForm {
  return { key: siguienteKeyEmpaque++, nombre: "", cantidad: 1, valorUnitario: 0 };
}

function totalEmpaques(lineas: LineaEmpaqueForm[]): number {
  return lineas.reduce((acc, l) => acc + l.cantidad * l.valorUnitario, 0);
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
 * (40% cemento / 60% marmolina, directo sobre el peso final) es fija.
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
  const [costoVinipel, setCostoVinipel] = useState(500);
  const [costoManoObra, setCostoManoObra] = useState(3000);
  const [multiplicadorPrecio, setMultiplicadorPrecio] = useState(3);
  const [redondeo, setRedondeo] = useState<0 | 100 | 500 | 1000>(100);
  // Empaques de ESTA pieza (caja, cinta, etc.) — nunca se guarda como
  // default, cada pieza lleva lo que le toque.
  const [lineasEmpaque, setLineasEmpaque] = useState<LineaEmpaqueForm[]>([]);

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
    costoVinipel,
    costoManoObra,
    multiplicadorPrecio,
    redondeo,
  };
  const costoEmpaques = totalEmpaques(lineasEmpaque);

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
        setCostoVinipel(Number(p.costo_vinipel));
        setCostoManoObra(Number(p.costo_mano_obra));
        setMultiplicadorPrecio(Number(p.multiplicador_precio));
        setRedondeo(Number(p.redondeo) as 0 | 100 | 500 | 1000);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los precios"));
  }, []);

  // Recalcula en vivo cuando cambia el peso, cualquier precio/costo, o los
  // empaques de la pieza.
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
        setResultado(await concretoApi.calcular({ pesoFinalG: pesoFinal, ...parametros, costoEmpaques }));
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
    costoVinipel,
    costoManoObra,
    multiplicadorPrecio,
    redondeo,
    costoEmpaques,
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

  // El precio de venta que devuelve el backend ya incluye vinipel+empaques
  // (se suman sin multiplicador, ver concreto.service.ts) — se resta acá
  // solo para mostrar por separado cuánto fue el múltiplo puro de materiales.
  const precioVentaBase = resultado ? resultado.precioVenta - resultado.costoVinipelYEmpaques : 0;

  const filas: { label: string; valor: string; fuerte?: boolean }[] = resultado
    ? [
        { label: "Peso final de la pieza", valor: formatGramos(resultado.pesoFinalG) },
        { label: "Cemento blanco (40%)", valor: formatGramos(resultado.cementoG) },
        { label: "Marmolina (60%)", valor: formatGramos(resultado.marmolinaG) },
        { label: "Costo cemento", valor: formatMoney(resultado.costoCemento) },
        { label: "Costo marmolina", valor: formatMoney(resultado.costoMarmolina) },
        {
          label: "Costos adicionales (agua, pintura, sellante, lija, mano de obra)",
          valor: formatMoney(resultado.costosAdicionales),
        },
        { label: "Costo total de producción", valor: formatMoney(resultado.costoTotal), fuerte: true },
        {
          label: `Precio de venta (× ${resultado.multiplicadorAplicado})`,
          valor: formatMoney(precioVentaBase),
        },
        {
          label: "+ Vinipel y empaques (sin multiplicador)",
          valor: formatMoney(resultado.costoVinipelYEmpaques),
        },
        {
          label: "Precio de venta final",
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
          La receta es fija (40% cemento blanco, 60% marmolina, directo sobre ese peso); los precios de abajo se
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
                placeholder="Ej. 580"
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
            <Campo label="Vinipel" unidad="$/pieza">
              <MoneyInput value={costoVinipel} onChange={setCostoVinipel} className={INPUT_CLASE} />
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

          {/* Empaques de esta pieza — nunca se guardan como default, cada
              pieza lleva lo que le toque (mismo criterio que el vinipel, pero
              variable en vez de un valor fijo). */}
          <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50/40 p-3 dark:bg-sky-950/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-sky-700 dark:text-sky-400">📦 Empaques de esta pieza</span>
              <button
                type="button"
                onClick={() => setLineasEmpaque([...lineasEmpaque, lineaEmpaqueVacia()])}
                className="text-xs font-medium text-sky-700 underline dark:text-sky-400"
              >
                + Agregar
              </button>
            </div>
            {lineasEmpaque.length === 0 && <p className="text-xs text-brand-ink/50">Sin empaque agregado todavía.</p>}
            {lineasEmpaque.map((l) => (
              <div key={l.key} className="mb-2 flex items-center gap-2">
                <input
                  value={l.nombre}
                  onChange={(e) =>
                    setLineasEmpaque(lineasEmpaque.map((x) => (x.key === l.key ? { ...x, nombre: e.target.value } : x)))
                  }
                  placeholder="Ej. Caja de cartón"
                  className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <span className="shrink-0 text-[11px] text-brand-ink/60 dark:text-brand-vanilla/60">Valor c/u</span>
                <MoneyInput
                  value={l.valorUnitario}
                  onChange={(v) => setLineasEmpaque(lineasEmpaque.map((x) => (x.key === l.key ? { ...x, valorUnitario: v } : x)))}
                  className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="cant."
                  value={l.cantidad || ""}
                  onChange={(e) =>
                    setLineasEmpaque(
                      lineasEmpaque.map((x) => (x.key === l.key ? { ...x, cantidad: Number(e.target.value) } : x)),
                    )
                  }
                  className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <button
                  type="button"
                  onClick={() => setLineasEmpaque(lineasEmpaque.filter((x) => x.key !== l.key))}
                  className="shrink-0 text-red-600"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
            {lineasEmpaque.length > 0 && (
              <p className="mt-1 text-right text-xs font-semibold text-sky-700 dark:text-sky-400">
                Total empaques: {formatMoney(costoEmpaques)}
              </p>
            )}
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
