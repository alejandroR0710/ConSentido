import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { ModalImprimir } from "../../../shared/components/ModalImprimir";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import {
  velasApi,
  type Cera,
  type CalculoReceta,
  type Fragancia,
  type InsumoVela,
  type Pabilo,
  type ProductoVelaResumen,
  type RecetaInput,
  type TipoVela,
} from "../api";
import { recetaAReciboProps } from "../factura";

let siguienteKey = 1;
interface LineaCeraForm {
  key: number;
  ceraId: string;
  gramos: number;
}
interface LineaFraganciaForm {
  key: number;
  fraganciaId: string;
  porcentaje: number;
}
interface LineaInsumoForm {
  key: number;
  manual: boolean;
  insumoId: string;
  // Solo se usan si manual es true — no está en el catálogo, se escribe a
  // mano solo para esta receta.
  nombreManual: string;
  valorUnitarioManual: number;
  cantidad: number;
}

const REDONDEOS = [
  { valor: 0, label: "Sin redondeo" },
  { valor: 100, label: "A la centena ($100)" },
  { valor: 500, label: "A $500" },
  { valor: 1000, label: "A $1.000" },
] as const;

// Debe coincidir con TIPO_VELA_MERMA_PORCENTAJE en velas.service.ts (backend)
// — acá solo se usa para mostrar el cálculo en vivo mientras se escribe, el
// servidor siempre recalcula con su propia copia como fuente de verdad.
const TIPOS_VELA: { valor: TipoVela; label: string; mermaPorcentaje: number }[] = [
  { valor: "decorativa", label: "Decorativa", mermaPorcentaje: 6 },
  { valor: "vaso", label: "Vaso", mermaPorcentaje: 12 },
  { valor: "wax_melt", label: "Wax melt", mermaPorcentaje: 10 },
];

function lineasInsumoAPayload(lineas: LineaInsumoForm[]): RecetaInput["insumos"] {
  return lineas
    .filter((l) => l.cantidad > 0 && (l.manual ? l.nombreManual.trim() : l.insumoId))
    .map((l) =>
      l.manual
        ? { nombreManual: l.nombreManual.trim(), valorUnitarioManual: l.valorUnitarioManual, cantidad: l.cantidad }
        : { insumoId: l.insumoId, cantidad: l.cantidad },
    );
}

function pesoEfectivoCera(pesoTotal: number, tipoVela: TipoVela): number {
  const merma = TIPOS_VELA.find((t) => t.valor === tipoVela)?.mermaPorcentaje ?? 0;
  return pesoTotal * (1 - merma / 100);
}

function formArmarInicial() {
  return {
    nombreReceta: "",
    tipoVela: "decorativa" as TipoVela,
    pesoMezclaG: 0,
    lineasCera: [{ key: siguienteKey++, ceraId: "", gramos: 0 }] as LineaCeraForm[],
    lineasFragancia: [] as LineaFraganciaForm[],
    pabiloId: "",
    cmPabilo: 0,
    lineasInsumo: [] as LineaInsumoForm[],
    costoManoObra: 0,
    multiplicadorPrecio: "" as number | "",
    redondeo: 100 as 0 | 100 | 500 | 1000,
    notas: "",
    precioFinalAutorizado: "" as number | "",
  };
}

/**
 * Arma una receta (ceras + fragancias + pabilo + insumos + mano de obra) y
 * muestra el desglose de costo EN VIVO llamando a POST /velas/calcular en
 * cada cambio (con un pequeño debounce) — nunca se calcula en el navegador,
 * siempre contra los precios vigentes del servidor. Guardar la persiste
 * como receta reutilizable; "Ver" en la lista de abajo la vuelve a cargar
 * acá para seguir editándola.
 */
export function CalculadoraTab() {
  const [ceras, setCeras] = useState<Cera[]>([]);
  const [fragancias, setFragancias] = useState<Fragancia[]>([]);
  const [pabilos, setPabilos] = useState<Pabilo[]>([]);
  const [insumos, setInsumos] = useState<InsumoVela[]>([]);
  const [recetas, setRecetas] = useState<ProductoVelaResumen[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);

  const [form, setForm] = useState(formArmarInicial);
  const [recetaIdActual, setRecetaIdActual] = useState<string | null>(null);
  // Recuerda el último valor que la propia calculadora autocompletó en la
  // única línea de cera, para no pisar un valor que el usuario ya cambió a
  // mano (ver efecto de autocompletar más abajo).
  const ultimoGramosAutocompletado = useRef<number | null>(null);

  const [calculo, setCalculo] = useState<CalculoReceta | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [errorCalculo, setErrorCalculo] = useState<string | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<ReturnType<typeof recetaAReciboProps> | null>(null);

  async function cargarCatalogo() {
    setCargandoCatalogo(true);
    try {
      const [c, f, p, i] = await Promise.all([
        velasApi.listarCeras(),
        velasApi.listarFragancias(),
        velasApi.listarPabilos(),
        velasApi.listarInsumos(),
      ]);
      setCeras(c);
      setFragancias(f);
      setPabilos(p);
      setInsumos(i);
    } catch {
      /* el formulario queda vacío, se puede reintentar recargando la página */
    } finally {
      setCargandoCatalogo(false);
    }
  }
  async function cargarRecetas() {
    try {
      setRecetas(await velasApi.listarProductos());
    } catch {
      /* la lista de guardadas queda vacía, no es crítico */
    }
  }
  useEffect(() => {
    cargarCatalogo();
    cargarRecetas();
  }, []);

  // Autocompletar el gramaje de la cera: cuando hay una sola línea de cera,
  // su valor tiene que ser el peso total menos la merma propia del tipo de
  // vela (decorativa -6%, vaso -12%, wax melt -10%) — nunca el peso total
  // "en bruto" tal cual se escribió. Si el usuario ya tocó ese campo a mano
  // (su valor no coincide con lo último que la calculadora puso ahí), se
  // respeta y no se vuelve a pisar.
  useEffect(() => {
    if (form.lineasCera.length !== 1 || form.pesoMezclaG <= 0) return;
    const [linea] = form.lineasCera;
    const yaTocadoAMano = linea.gramos > 0 && linea.gramos !== ultimoGramosAutocompletado.current;
    if (yaTocadoAMano) return;
    const gramos = Math.round(pesoEfectivoCera(form.pesoMezclaG, form.tipoVela) * 100) / 100;
    ultimoGramosAutocompletado.current = gramos;
    setForm((f) => ({ ...f, lineasCera: f.lineasCera.map((x) => (x.key === linea.key ? { ...x, gramos } : x)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.pesoMezclaG, form.tipoVela]);

  // Desglose en vivo: recalcula contra el servidor cada vez que cambia algo
  // de la receta, con un pequeño debounce para no saturar mientras se escribe.
  useEffect(() => {
    const ceraLineas = form.lineasCera.filter((l) => l.ceraId && l.gramos > 0).map((l) => ({ ceraId: l.ceraId, gramos: l.gramos }));
    if (ceraLineas.length === 0 || form.pesoMezclaG <= 0) {
      setCalculo(null);
      return;
    }
    const payload: RecetaInput = {
      tipoVela: form.tipoVela,
      pesoMezclaG: form.pesoMezclaG,
      ceras: ceraLineas,
      fragancias: form.lineasFragancia
        .filter((l) => l.fraganciaId && l.porcentaje > 0)
        .map((l) => ({ fraganciaId: l.fraganciaId, porcentaje: l.porcentaje })),
      pabiloId: form.pabiloId || undefined,
      cmPabilo: form.cmPabilo > 0 ? form.cmPabilo : undefined,
      insumos: lineasInsumoAPayload(form.lineasInsumo),
      costoManoObra: form.costoManoObra,
      multiplicadorPrecio: form.multiplicadorPrecio === "" ? undefined : form.multiplicadorPrecio,
      redondeo: form.redondeo,
    };
    const timeout = setTimeout(async () => {
      setCalculando(true);
      setErrorCalculo(null);
      try {
        setCalculo(await velasApi.calcular(payload));
      } catch (err) {
        setCalculo(null);
        setErrorCalculo(err instanceof ApiError ? err.message : "No se pudo calcular");
      } finally {
        setCalculando(false);
      }
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tipoVela, form.pesoMezclaG, form.lineasCera, form.lineasFragancia, form.pabiloId, form.cmPabilo, form.lineasInsumo, form.costoManoObra, form.multiplicadorPrecio, form.redondeo]);

  function nuevaReceta() {
    setForm(formArmarInicial());
    setRecetaIdActual(null);
    setCalculo(null);
    setMensaje(null);
    setErrorGuardar(null);
  }

  async function verReceta(id: string) {
    setErrorGuardar(null);
    try {
      const detalle = await velasApi.obtenerProducto(id);
      // Evita que el efecto de autocompletar pise el gramaje ya guardado de
      // la receta al abrirla (se considera "ya tocado a mano").
      ultimoGramosAutocompletado.current = null;
      setForm({
        nombreReceta: detalle.nombre,
        tipoVela: detalle.composicion.tipoVela,
        pesoMezclaG: detalle.composicion.pesoMezclaG,
        lineasCera: detalle.composicion.ceras.map((c) => ({ key: siguienteKey++, ceraId: c.ceraId, gramos: c.gramos })),
        lineasFragancia: detalle.composicion.fragancias.map((f) => ({ key: siguienteKey++, fraganciaId: f.fraganciaId, porcentaje: f.porcentaje })),
        pabiloId: detalle.composicion.pabiloId ?? "",
        cmPabilo: detalle.composicion.cmPabilo ?? 0,
        lineasInsumo: detalle.composicion.insumos.map((i) =>
          "insumoId" in i
            ? { key: siguienteKey++, manual: false, insumoId: i.insumoId, nombreManual: "", valorUnitarioManual: 0, cantidad: i.cantidad }
            : {
                key: siguienteKey++,
                manual: true,
                insumoId: "",
                nombreManual: i.nombreManual,
                valorUnitarioManual: i.valorUnitarioManual,
                cantidad: i.cantidad,
              },
        ),
        costoManoObra: detalle.composicion.costoManoObra,
        multiplicadorPrecio: detalle.composicion.multiplicadorPrecio ?? "",
        redondeo: detalle.composicion.redondeo as 0 | 100 | 500 | 1000,
        notas: detalle.notas ?? "",
        precioFinalAutorizado: detalle.precioFinalAutorizado ?? "",
      });
      setRecetaIdActual(id);
      setCalculo(detalle.costo);
      setMensaje(null);
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No se pudo abrir la receta");
    }
  }

  function payloadReceta(): RecetaInput & { nombre: string; notas?: string; precioFinalAutorizado?: number } {
    return {
      nombre: form.nombreReceta.trim(),
      tipoVela: form.tipoVela,
      pesoMezclaG: form.pesoMezclaG,
      ceras: form.lineasCera.filter((l) => l.ceraId && l.gramos > 0).map((l) => ({ ceraId: l.ceraId, gramos: l.gramos })),
      fragancias: form.lineasFragancia
        .filter((l) => l.fraganciaId && l.porcentaje > 0)
        .map((l) => ({ fraganciaId: l.fraganciaId, porcentaje: l.porcentaje })),
      pabiloId: form.pabiloId || undefined,
      cmPabilo: form.cmPabilo > 0 ? form.cmPabilo : undefined,
      insumos: lineasInsumoAPayload(form.lineasInsumo),
      costoManoObra: form.costoManoObra,
      multiplicadorPrecio: form.multiplicadorPrecio === "" ? undefined : form.multiplicadorPrecio,
      redondeo: form.redondeo,
      notas: form.notas.trim() || undefined,
      precioFinalAutorizado: form.precioFinalAutorizado === "" ? undefined : form.precioFinalAutorizado,
    };
  }

  async function guardar() {
    if (!form.nombreReceta.trim()) {
      setErrorGuardar("Ponle un nombre a la receta antes de guardar");
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    setMensaje(null);
    try {
      const payload = payloadReceta();
      const resultado = recetaIdActual
        ? await velasApi.editarProducto(recetaIdActual, payload)
        : await velasApi.crearProducto(payload);
      setRecetaIdActual(resultado.id);
      setCalculo(resultado.costo);
      setMensaje(recetaIdActual ? "Receta actualizada." : "Receta guardada.");
      await cargarRecetas();
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No se pudo guardar la receta");
    } finally {
      setGuardando(false);
    }
  }

  async function duplicar() {
    if (!recetaIdActual) return;
    try {
      const dup = await velasApi.duplicarProducto(recetaIdActual);
      await cargarRecetas();
      await verReceta(dup.id);
      setMensaje(`Duplicada como "${dup.nombre}".`);
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No se pudo duplicar");
    }
  }

  async function eliminar(id: string) {
    try {
      await velasApi.eliminarProducto(id);
      if (id === recetaIdActual) nuevaReceta();
      await cargarRecetas();
    } catch (err) {
      setErrorGuardar(err instanceof ApiError ? err.message : "No se pudo eliminar");
    }
  }

  function abrirImpresion() {
    if (!calculo) return;
    setRecibo(recetaAReciboProps(form.nombreReceta.trim() || "Sin nombre", calculo));
  }

  if (cargandoCatalogo) return <p className="text-sm text-brand-ink/60">Cargando catálogo...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ------- Columna izquierda: armar receta ------- */}
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Nombre de la receta</label>
            <input
              value={form.nombreReceta}
              onChange={(e) => setForm({ ...form, nombreReceta: e.target.value })}
              placeholder='Ej. "Vela Citrus 180g"'
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
            />
          </div>

          <div className="flex gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Tipo de vela</label>
              <select
                value={form.tipoVela}
                onChange={(e) => setForm({ ...form, tipoVela: e.target.value as TipoVela })}
                className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              >
                {TIPOS_VELA.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label} (-{t.mermaPorcentaje}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Peso total pesado (g)</label>
              <input
                type="number"
                min={0}
                value={form.pesoMezclaG || ""}
                onChange={(e) => setForm({ ...form, pesoMezclaG: Number(e.target.value) })}
                className="w-32 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
          </div>
          {form.pesoMezclaG > 0 && (
            <p className="-mt-2 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
              Cera aprovechable: {pesoEfectivoCera(form.pesoMezclaG, form.tipoVela).toFixed(1)}g (peso total menos la
              merma del tipo de vela)
              {form.lineasCera.length === 1 && " · ya se puso sola en la línea de cera de abajo"}
            </p>
          )}

          {/* Ceras */}
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50/40 p-3 dark:bg-amber-950/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">🕯️ Ceras</span>
              <button
                onClick={() => setForm({ ...form, lineasCera: [...form.lineasCera, { key: siguienteKey++, ceraId: "", gramos: 0 }] })}
                className="text-xs font-medium text-amber-800 underline dark:text-amber-400"
              >
                + Agregar cera
              </button>
            </div>
            {form.lineasCera.map((l) => (
              <div key={l.key} className="mb-1 flex items-center gap-2">
                <select
                  value={l.ceraId}
                  onChange={(e) =>
                    setForm({ ...form, lineasCera: form.lineasCera.map((x) => (x.key === l.key ? { ...x, ceraId: e.target.value } : x)) })
                  }
                  className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                >
                  <option value="">Elegir cera...</option>
                  {ceras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  placeholder="g"
                  value={l.gramos || ""}
                  onChange={(e) =>
                    setForm({ ...form, lineasCera: form.lineasCera.map((x) => (x.key === l.key ? { ...x, gramos: Number(e.target.value) } : x)) })
                  }
                  className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <button
                  onClick={() => setForm({ ...form, lineasCera: form.lineasCera.filter((x) => x.key !== l.key) })}
                  disabled={form.lineasCera.length === 1}
                  className="text-red-600 disabled:opacity-30"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Fragancias */}
          <div className="rounded-lg border-l-4 border-brand-green-600 bg-brand-green-50/40 p-3 dark:bg-brand-green-700/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-green-700 dark:text-brand-vanilla">🌸 Fragancias</span>
              <button
                onClick={() => setForm({ ...form, lineasFragancia: [...form.lineasFragancia, { key: siguienteKey++, fraganciaId: "", porcentaje: 0 }] })}
                className="text-xs font-medium text-brand-green-700 underline dark:text-brand-vanilla"
              >
                + Agregar fragancia
              </button>
            </div>
            {form.lineasFragancia.length === 0 && <p className="text-xs text-brand-ink/50">Sin fragancia (opcional).</p>}
            {form.lineasFragancia.map((l) => (
              <div key={l.key} className="mb-1 flex items-center gap-2">
                <select
                  value={l.fraganciaId}
                  onChange={(e) =>
                    setForm({ ...form, lineasFragancia: form.lineasFragancia.map((x) => (x.key === l.key ? { ...x, fraganciaId: e.target.value } : x)) })
                  }
                  className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                >
                  <option value="">Elegir fragancia...</option>
                  {fragancias.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nombre}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="%"
                  value={l.porcentaje || ""}
                  onChange={(e) =>
                    setForm({ ...form, lineasFragancia: form.lineasFragancia.map((x) => (x.key === l.key ? { ...x, porcentaje: Number(e.target.value) } : x)) })
                  }
                  className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                />
                <button
                  onClick={() => setForm({ ...form, lineasFragancia: form.lineasFragancia.filter((x) => x.key !== l.key) })}
                  className="text-red-600"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Pabilo */}
          <div className="rounded-lg border-l-4 border-slate-500 bg-slate-50/60 p-3 dark:bg-slate-800/20">
            <span className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-300">🧵 Pabilo</span>
            <div className="flex items-center gap-2">
              <select
                value={form.pabiloId}
                onChange={(e) => setForm({ ...form, pabiloId: e.target.value })}
                className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              >
                <option value="">Sin pabilo</option>
                {pabilos.map((p) => (
                  <option key={p.id} value={p.id}>
                    Talla {p.talla}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                placeholder="cm"
                value={form.cmPabilo || ""}
                onChange={(e) => setForm({ ...form, cmPabilo: Number(e.target.value) })}
                className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
          </div>

          {/* Insumos / empaque */}
          <div className="rounded-lg border-l-4 border-sky-500 bg-sky-50/40 p-3 dark:bg-sky-950/10">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-sky-700 dark:text-sky-400">📦 Recipiente / empaque / accesorios</span>
              <button
                onClick={() =>
                  setForm({
                    ...form,
                    lineasInsumo: [
                      ...form.lineasInsumo,
                      { key: siguienteKey++, manual: false, insumoId: "", nombreManual: "", valorUnitarioManual: 0, cantidad: 1 },
                    ],
                  })
                }
                className="text-xs font-medium text-sky-700 underline dark:text-sky-400"
              >
                + Agregar
              </button>
            </div>
            {form.lineasInsumo.length === 0 && <p className="text-xs text-brand-ink/50">Sin empaque agregado todavía.</p>}
            {form.lineasInsumo.map((l) => (
              <div key={l.key} className="mb-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {l.manual ? (
                    <input
                      value={l.nombreManual}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          lineasInsumo: form.lineasInsumo.map((x) => (x.key === l.key ? { ...x, nombreManual: e.target.value } : x)),
                        })
                      }
                      placeholder="Ej. Frasco reciclado 250ml"
                      className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                    />
                  ) : (
                    <select
                      value={l.insumoId}
                      onChange={(e) =>
                        setForm({ ...form, lineasInsumo: form.lineasInsumo.map((x) => (x.key === l.key ? { ...x, insumoId: e.target.value } : x)) })
                      }
                      className="min-w-0 flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                    >
                      <option value="">Elegir insumo...</option>
                      {insumos.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.nombre}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        lineasInsumo: form.lineasInsumo.map((x) =>
                          x.key === l.key
                            ? { ...x, manual: !x.manual, insumoId: "", nombreManual: "", valorUnitarioManual: 0 }
                            : x,
                        ),
                      })
                    }
                    className="shrink-0 rounded-full border border-sky-600 px-2 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-400 dark:text-sky-400 dark:hover:bg-sky-950/30"
                  >
                    {l.manual ? "← elegir del catálogo" : "✎ uno manual"}
                  </button>
                  <button
                    onClick={() => setForm({ ...form, lineasInsumo: form.lineasInsumo.filter((x) => x.key !== l.key) })}
                    className="text-red-600"
                    aria-label="Quitar"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {l.manual && (
                    <>
                      <span className="text-[11px] text-brand-ink/60 dark:text-brand-vanilla/60">Valor c/u</span>
                      <MoneyInput
                        value={l.valorUnitarioManual}
                        onChange={(v) =>
                          setForm({
                            ...form,
                            lineasInsumo: form.lineasInsumo.map((x) => (x.key === l.key ? { ...x, valorUnitarioManual: v } : x)),
                          })
                        }
                        className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </>
                  )}
                  <input
                    type="number"
                    min={0}
                    placeholder="cant."
                    value={l.cantidad || ""}
                    onChange={(e) =>
                      setForm({ ...form, lineasInsumo: form.lineasInsumo.map((x) => (x.key === l.key ? { ...x, cantidad: Number(e.target.value) } : x)) })
                    }
                    className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Mano de obra, multiplicador, redondeo */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Costo de mano de obra</label>
              <MoneyInput
                value={form.costoManoObra}
                onChange={(v) => setForm({ ...form, costoManoObra: v })}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Multiplicador (vacío = usa el global)</label>
              <input
                type="number"
                min={0}
                step="0.1"
                placeholder="×4"
                value={form.multiplicadorPrecio}
                onChange={(e) => setForm({ ...form, multiplicadorPrecio: e.target.value === "" ? "" : Number(e.target.value) })}
                className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1.5 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Redondeo del precio sugerido</label>
            <select
              value={form.redondeo}
              onChange={(e) => setForm({ ...form, redondeo: Number(e.target.value) as 0 | 100 | 500 | 1000 })}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
            >
              {REDONDEOS.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Notas (opcional)</label>
            <textarea
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              rows={2}
              className="w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Precio final autorizado (opcional, distinto del sugerido)</label>
            <MoneyInput
              value={form.precioFinalAutorizado === "" ? 0 : form.precioFinalAutorizado}
              onChange={(v) => setForm({ ...form, precioFinalAutorizado: v || "" })}
              className="w-40 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
            />
          </div>

          {errorGuardar && <p className="text-sm text-red-600">{errorGuardar}</p>}
          {mensaje && <p className="text-sm text-brand-green-700 dark:text-brand-vanilla">{mensaje}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded-md bg-brand-green-700 px-4 py-2.5 text-sm font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
            >
              {guardando ? "Guardando..." : recetaIdActual ? "Guardar cambios" : "Guardar receta"}
            </button>
            <button
              onClick={nuevaReceta}
              className="rounded-md border border-brand-vanilla-dark px-4 py-2.5 text-sm font-medium hover:bg-brand-green-50 dark:border-brand-green-700 dark:hover:bg-brand-green-700/30"
            >
              Nueva receta
            </button>
            {recetaIdActual && (
              <button
                onClick={duplicar}
                className="rounded-md border border-brand-vanilla-dark px-4 py-2.5 text-sm font-medium hover:bg-brand-green-50 dark:border-brand-green-700 dark:hover:bg-brand-green-700/30"
              >
                Duplicar
              </button>
            )}
            <button
              onClick={abrirImpresion}
              disabled={!calculo}
              className="rounded-md border border-brand-vanilla-dark px-4 py-2.5 text-sm font-medium hover:bg-brand-green-50 disabled:opacity-40 dark:border-brand-green-700 dark:hover:bg-brand-green-700/30"
            >
              🖨️ Imprimir desglose
            </button>
          </div>
        </div>

        {/* ------- Columna derecha: desglose en vivo ------- */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border-2 border-brand-green-600 bg-brand-vanilla p-4 dark:border-brand-green-500 dark:bg-brand-green-900/20">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla">
              Desglose {calculando && <span className="font-normal text-brand-ink/50">(calculando...)</span>}
            </h2>

            {errorCalculo && <p className="mb-2 text-sm text-red-600">{errorCalculo}</p>}

            {!calculo ? (
              <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
                Agrega al menos una cera y el peso de la mezcla para ver el costo.
              </p>
            ) : (
              <div className="flex flex-col gap-3 text-sm">
                {calculo.alertas.length > 0 && (
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    {calculo.alertas.map((a, idx) => (
                      <div key={idx}>⚠ {a}</div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  {calculo.lineasCera.map((l, idx) => (
                    <div key={`cera-${idx}`} className="flex justify-between text-amber-800 dark:text-amber-400">
                      <span>🕯️ {l.nombre} ({l.gramos}g)</span>
                      <span>{formatMoney(l.costo)}</span>
                    </div>
                  ))}
                  {calculo.lineasFragancia.map((l, idx) => (
                    <div key={`frag-${idx}`} className="flex justify-between text-brand-green-700 dark:text-brand-vanilla">
                      <span>
                        🌸 {l.nombre} ({l.porcentaje}% · {l.gramos.toFixed(1)}g)
                      </span>
                      <span>{formatMoney(l.costo)}</span>
                    </div>
                  ))}
                  {calculo.lineaPabilo && (
                    <div className="flex justify-between text-slate-700 dark:text-slate-300">
                      <span>
                        🧵 {calculo.lineaPabilo.nombre} ({calculo.lineaPabilo.cm}cm)
                      </span>
                      <span>{formatMoney(calculo.lineaPabilo.costo)}</span>
                    </div>
                  )}
                  {calculo.lineasInsumo.map((l, idx) => (
                    <div key={`ins-${idx}`} className="flex justify-between text-sky-700 dark:text-sky-400">
                      <span>
                        📦 {l.nombre} (x{l.cantidad})
                      </span>
                      <span>{formatMoney(l.costo)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1 border-t border-brand-vanilla-dark pt-2 dark:border-brand-green-700">
                  <div className="flex justify-between text-brand-ink/70 dark:text-brand-vanilla/70">
                    <span>👷 Mano de obra</span>
                    <span>{formatMoney(calculo.costoManoObra)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Costo base (cera + fragancia + pabilo + mano de obra)</span>
                    <span className="font-medium">{formatMoney(calculo.costoBase)}</span>
                  </div>
                  <div className="flex justify-between text-brand-ink/70 dark:text-brand-vanilla/70">
                    <span>× multiplicador ({calculo.multiplicadorAplicado})</span>
                    <span>{formatMoney(calculo.costoBase * calculo.multiplicadorAplicado)}</span>
                  </div>
                  {calculo.costoInsumos > 0 && (
                    <div className="flex justify-between text-brand-ink/70 dark:text-brand-vanilla/70">
                      <span>📦 + Empaque (no lleva multiplicador)</span>
                      <span>{formatMoney(calculo.costoInsumos)}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-md bg-brand-green-50 px-3 py-2 dark:bg-brand-green-700/20">
                  <span className="font-semibold text-brand-green-700 dark:text-brand-vanilla">COSTO TOTAL (real)</span>
                  <span className="text-xl font-bold text-brand-green-700 dark:text-brand-vanilla">{formatMoney(calculo.costoTotal)}</span>
                </div>

                <div className="flex items-center justify-between rounded-md border-2 border-brand-green-700 bg-white px-3 py-3 dark:bg-brand-green-900">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-brand-ink/60 dark:text-brand-vanilla/60">
                      Precio sugerido (×{calculo.multiplicadorAplicado} + empaque)
                    </div>
                    <div className="text-3xl font-bold text-brand-green-700 dark:text-brand-vanilla">{formatMoney(calculo.precioVenta)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ------- Recetas guardadas ------- */}
      <div>
        <h2 className="mb-3 font-medium text-brand-green-700 dark:text-brand-vanilla">Recetas guardadas</h2>
        {recetas.length === 0 ? (
          <p className="text-sm text-brand-ink/60 dark:text-brand-vanilla/60">Todavía no hay recetas guardadas.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recetas.map((r) => (
              <div
                key={r.id}
                className={`rounded-lg border p-3 ${
                  r.id === recetaIdActual
                    ? "border-brand-green-600 bg-brand-green-50/40 dark:bg-brand-green-700/10"
                    : "border-brand-vanilla-dark dark:border-brand-green-700"
                } ${r.activo ? "" : "opacity-50"}`}
              >
                <div className="mb-1 font-medium text-brand-ink dark:text-brand-vanilla">{r.nombre}</div>
                <div className="mb-1 text-xs text-brand-ink/60 dark:text-brand-vanilla/60">
                  Costo {formatMoney(r.costoTotal)} · Sugerido {formatMoney(r.precioSugerido)}
                </div>
                {r.precioFinalAutorizado != null && (
                  <div className="mb-1 text-xs font-semibold text-brand-green-700 dark:text-brand-vanilla">
                    Autorizado: {formatMoney(r.precioFinalAutorizado)}
                  </div>
                )}
                {r.alertas.length > 0 && <div className="mb-1 text-xs text-amber-700 dark:text-amber-400">⚠ {r.alertas.length} alerta(s)</div>}
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => verReceta(r.id)}
                    className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                  >
                    Ver
                  </button>
                  <button
                    onClick={() => eliminar(r.id)}
                    className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {recibo && <ModalImprimir {...recibo} onCerrar={() => setRecibo(null)} />}
    </div>
  );
}
