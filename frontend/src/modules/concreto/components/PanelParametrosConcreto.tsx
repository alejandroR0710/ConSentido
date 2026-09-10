import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { concretoApi } from "../api";

const REDONDEOS: { valor: 0 | 100 | 500 | 1000; label: string }[] = [
  { valor: 0, label: "Sin redondeo" },
  { valor: 100, label: "A $100" },
  { valor: 500, label: "A $500" },
  { valor: 1000, label: "A $1.000" },
];

/** Precios de material, costos fijos por pieza, mano de obra, multiplicador de
 *  venta y redondeo — lo único editable. La receta (40% cemento / 60% marmolina
 *  / 24% agua y el factor de conversión) va fija en el código. */
export function PanelParametrosConcreto({ onGuardado }: { onGuardado?: () => void }) {
  const [precioCementoGramo, setPrecioCementoGramo] = useState(2.125);
  const [precioMarmolinaGramo, setPrecioMarmolinaGramo] = useState(0.7975);
  const [costoAgua, setCostoAgua] = useState(400);
  const [costoPintura, setCostoPintura] = useState(400);
  const [costoSellante, setCostoSellante] = useState(200);
  const [costoLija, setCostoLija] = useState(100);
  const [costoManoObra, setCostoManoObra] = useState(3000);
  const [multiplicadorPrecio, setMultiplicadorPrecio] = useState(3);
  const [redondeo, setRedondeo] = useState<0 | 100 | 500 | 1000>(100);

  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

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
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar los parámetros"))
      .finally(() => setLoading(false));
  }, []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      await concretoApi.actualizarParametros({
        precioCementoGramo,
        precioMarmolinaGramo,
        costoAgua,
        costoPintura,
        costoSellante,
        costoLija,
        costoManoObra,
        multiplicadorPrecio,
        redondeo,
      });
      setMensaje("Parámetros guardados.");
      onGuardado?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-sm text-brand-ink/60">Cargando...</p>;

  const inputClase =
    "w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";

  return (
    <div className="flex max-w-xl flex-col gap-5 rounded-lg border border-brand-vanilla-dark p-4 dark:border-brand-green-700">
      <p className="text-sm text-brand-ink/70 dark:text-brand-vanilla/70">
        La receta de fabricación es fija (40% cemento blanco, 60% marmolina, 24% agua, factor de mezcla 1,8). Acá solo
        se ajustan los precios y costos cuando cambien.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Precio cemento blanco ($/gramo)</label>
          <NumeroInput value={precioCementoGramo} onChange={setPrecioCementoGramo} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Precio marmolina ($/gramo)</label>
          <NumeroInput value={precioMarmolinaGramo} onChange={setPrecioMarmolinaGramo} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Agua ($/pieza)</label>
          <MoneyInput value={costoAgua} onChange={setCostoAgua} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Pintura acrílica ($/pieza)</label>
          <MoneyInput value={costoPintura} onChange={setCostoPintura} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Sellante ($/pieza)</label>
          <MoneyInput value={costoSellante} onChange={setCostoSellante} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Lija ($/pieza)</label>
          <MoneyInput value={costoLija} onChange={setCostoLija} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Mano de obra ($/pieza)</label>
          <MoneyInput value={costoManoObra} onChange={setCostoManoObra} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Multiplicador de precio de venta</label>
          <NumeroInput value={multiplicadorPrecio} onChange={setMultiplicadorPrecio} className={inputClase} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Redondeo del precio de venta</label>
          <select
            value={redondeo}
            onChange={(e) => setRedondeo(Number(e.target.value) as 0 | 100 | 500 | 1000)}
            className={inputClase}
          >
            {REDONDEOS.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-fit rounded-md bg-brand-green-700 px-4 py-2 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar parámetros"}
      </button>
    </div>
  );
}
