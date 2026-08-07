import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { velasApi, type CategoriaInsumoVela, type InsumoVela, type UnidadCostoVela } from "../api";

const CATEGORIAS: { value: CategoriaInsumoVela; label: string }[] = [
  { value: "recipiente", label: "Recipiente" },
  { value: "tapa", label: "Tapa" },
  { value: "empaque", label: "Empaque" },
  { value: "decoracion", label: "Decoración" },
  { value: "identidad", label: "Identidad" },
  { value: "papeleria", label: "Papelería" },
  { value: "proteccion", label: "Protección" },
  { value: "otro", label: "Otro" },
];
const UNIDADES: UnidadCostoVela[] = ["unidad", "cm", "g", "hoja", "metro"];

interface FormInsumo {
  codigo: string;
  nombre: string;
  categoria: CategoriaInsumoVela;
  unidadCosto: UnidadCostoVela;
  valorUnitario: number;
  cantidadPorPaquete: number;
  precioPaquete: number;
  proveedor: string;
}
const FORM_VACIO: FormInsumo = {
  codigo: "",
  nombre: "",
  categoria: "empaque",
  unidadCosto: "unidad",
  valorUnitario: 0,
  cantidadPorPaquete: 0,
  precioPaquete: 0,
  proveedor: "",
};

/** cantidadPorPaquete/precioPaquete son solo ayuda visual para calcular
 *  valorUnitario a mano (ej. "docena a $48.000 = $4.000 c/u") — si se llenan
 *  los dos, se ofrece autocompletar valorUnitario, pero lo que de verdad se
 *  guarda y usa en una receta es siempre valorUnitario. */
export function TablaInsumos() {
  const [insumos, setInsumos] = useState<InsumoVela[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [formNuevo, setFormNuevo] = useState<FormInsumo>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEditar, setFormEditar] = useState<FormInsumo>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setInsumos(await velasApi.listarInsumosAdmin());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar los insumos");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicion(i: InsumoVela) {
    setEditandoId(i.id);
    setFormEditar({
      codigo: i.codigo ?? "",
      nombre: i.nombre,
      categoria: i.categoria,
      unidadCosto: i.unidad_costo,
      valorUnitario: Number(i.valor_unitario),
      cantidadPorPaquete: i.cantidad_por_paquete ? Number(i.cantidad_por_paquete) : 0,
      precioPaquete: i.precio_paquete ? Number(i.precio_paquete) : 0,
      proveedor: i.proveedor ?? "",
    });
  }

  function autocompletarValorUnitario(form: FormInsumo, set: (f: FormInsumo) => void) {
    if (form.cantidadPorPaquete > 0 && form.precioPaquete > 0) {
      set({ ...form, valorUnitario: Math.round((form.precioPaquete / form.cantidadPorPaquete) * 100) / 100 });
    }
  }

  async function guardarNuevo() {
    if (!formNuevo.nombre.trim() || formNuevo.valorUnitario <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      await velasApi.crearInsumo({
        codigo: formNuevo.codigo.trim() || undefined,
        nombre: formNuevo.nombre.trim(),
        categoria: formNuevo.categoria,
        unidadCosto: formNuevo.unidadCosto,
        valorUnitario: formNuevo.valorUnitario,
        cantidadPorPaquete: formNuevo.cantidadPorPaquete > 0 ? formNuevo.cantidadPorPaquete : undefined,
        precioPaquete: formNuevo.precioPaquete > 0 ? formNuevo.precioPaquete : undefined,
        proveedor: formNuevo.proveedor.trim() || undefined,
      });
      setFormNuevo(FORM_VACIO);
      setAgregando(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el insumo");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    setError(null);
    try {
      await velasApi.editarInsumo(id, {
        codigo: formEditar.codigo.trim() || undefined,
        nombre: formEditar.nombre.trim(),
        categoria: formEditar.categoria,
        unidadCosto: formEditar.unidadCosto,
        valorUnitario: formEditar.valorUnitario,
        cantidadPorPaquete: formEditar.cantidadPorPaquete > 0 ? formEditar.cantidadPorPaquete : undefined,
        precioPaquete: formEditar.precioPaquete > 0 ? formEditar.precioPaquete : undefined,
        proveedor: formEditar.proveedor.trim() || undefined,
      });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el insumo");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(i: InsumoVela) {
    try {
      await velasApi.editarInsumo(i.id, { activo: !i.activo });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Valor unitario</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : (
              insumos.map((i) =>
                editandoId === i.id ? (
                  <tr key={i.id} className="border-t border-brand-vanilla-dark bg-brand-green-50/40 dark:border-brand-green-700 dark:bg-brand-green-700/10">
                    <td className="px-3 py-2">
                      <input
                        value={formEditar.codigo}
                        onChange={(e) => setFormEditar({ ...formEditar, codigo: e.target.value })}
                        className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={formEditar.nombre}
                        onChange={(e) => setFormEditar({ ...formEditar, nombre: e.target.value })}
                        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={formEditar.categoria}
                        onChange={(e) => setFormEditar({ ...formEditar, categoria: e.target.value as CategoriaInsumoVela })}
                        className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      >
                        {CATEGORIAS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={formEditar.unidadCosto}
                        onChange={(e) => setFormEditar({ ...formEditar, unidadCosto: e.target.value as UnidadCostoVela })}
                        className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      >
                        {UNIDADES.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <MoneyInput
                          value={formEditar.valorUnitario}
                          onChange={(v) => setFormEditar({ ...formEditar, valorUnitario: v })}
                          className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                        />
                        <button
                          type="button"
                          title="Calcular desde paquete (cantidad y precio abajo)"
                          onClick={() => autocompletarValorUnitario(formEditar, setFormEditar)}
                          className="text-xs text-brand-green-700 underline dark:text-brand-vanilla"
                        >
                          calc.
                        </button>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-brand-ink/50">
                        <input
                          type="number"
                          min={0}
                          placeholder="cant/paq"
                          value={formEditar.cantidadPorPaquete || ""}
                          onChange={(e) => setFormEditar({ ...formEditar, cantidadPorPaquete: Number(e.target.value) })}
                          className="w-16 rounded border border-brand-vanilla-dark bg-brand-vanilla px-1 py-0.5 dark:border-brand-green-700 dark:bg-brand-green-900"
                        />
                        <MoneyInput
                          value={formEditar.precioPaquete}
                          onChange={(v) => setFormEditar({ ...formEditar, precioPaquete: v })}
                          placeholder="$ paquete"
                          className="w-20 rounded border border-brand-vanilla-dark bg-brand-vanilla px-1 py-0.5 dark:border-brand-green-700 dark:bg-brand-green-900"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-ink/50">{i.activo ? "Activo" : "Inactivo"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => guardarEdicion(i.id)}
                          disabled={guardando}
                          className="rounded-md bg-brand-green-700 px-2 py-1 text-xs font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditandoId(null)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs dark:border-brand-green-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={i.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${i.activo ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{i.codigo ?? "—"}</td>
                    <td className="px-3 py-2">{i.nombre}</td>
                    <td className="px-3 py-2 capitalize">{CATEGORIAS.find((c) => c.value === i.categoria)?.label}</td>
                    <td className="px-3 py-2">{i.unidad_costo}</td>
                    <td className="px-3 py-2 font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      {formatMoney(i.valor_unitario)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          i.activo
                            ? "rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                            : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300"
                        }
                      >
                        {i.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => empezarEdicion(i)}
                          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarActivo(i)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          {i.activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )
            )}
            {agregando && (
              <tr className="border-t-2 border-brand-green-600 bg-brand-green-50/40 dark:border-brand-green-500 dark:bg-brand-green-700/10">
                <td className="px-3 py-2">
                  <input
                    placeholder="Código"
                    value={formNuevo.codigo}
                    onChange={(e) => setFormNuevo({ ...formNuevo, codigo: e.target.value })}
                    className="w-20 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    autoFocus
                    placeholder="Nombre"
                    value={formNuevo.nombre}
                    onChange={(e) => setFormNuevo({ ...formNuevo, nombre: e.target.value })}
                    className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={formNuevo.categoria}
                    onChange={(e) => setFormNuevo({ ...formNuevo, categoria: e.target.value as CategoriaInsumoVela })}
                    className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={formNuevo.unidadCosto}
                    onChange={(e) => setFormNuevo({ ...formNuevo, unidadCosto: e.target.value as UnidadCostoVela })}
                    className="rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  >
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <MoneyInput
                      value={formNuevo.valorUnitario}
                      onChange={(v) => setFormNuevo({ ...formNuevo, valorUnitario: v })}
                      placeholder="Valor c/u"
                      className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                    />
                    <button
                      type="button"
                      title="Calcular desde paquete (cantidad y precio abajo)"
                      onClick={() => autocompletarValorUnitario(formNuevo, setFormNuevo)}
                      className="text-xs text-brand-green-700 underline dark:text-brand-vanilla"
                    >
                      calc.
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-brand-ink/50">
                    <input
                      type="number"
                      min={0}
                      placeholder="cant/paq"
                      value={formNuevo.cantidadPorPaquete || ""}
                      onChange={(e) => setFormNuevo({ ...formNuevo, cantidadPorPaquete: Number(e.target.value) })}
                      className="w-16 rounded border border-brand-vanilla-dark bg-brand-vanilla px-1 py-0.5 dark:border-brand-green-700 dark:bg-brand-green-900"
                    />
                    <MoneyInput
                      value={formNuevo.precioPaquete}
                      onChange={(v) => setFormNuevo({ ...formNuevo, precioPaquete: v })}
                      placeholder="$ paquete"
                      className="w-20 rounded border border-brand-vanilla-dark bg-brand-vanilla px-1 py-0.5 dark:border-brand-green-700 dark:bg-brand-green-900"
                    />
                  </div>
                </td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      onClick={guardarNuevo}
                      disabled={guardando}
                      className="rounded-md bg-brand-green-700 px-2 py-1 text-xs font-medium text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => {
                        setAgregando(false);
                        setFormNuevo(FORM_VACIO);
                      }}
                      className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs dark:border-brand-green-700"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!agregando && (
        <button
          onClick={() => setAgregando(true)}
          className="w-fit rounded-md border-2 border-brand-green-700 px-3 py-1.5 text-sm font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/30"
        >
          + Nuevo insumo
        </button>
      )}
    </div>
  );
}
