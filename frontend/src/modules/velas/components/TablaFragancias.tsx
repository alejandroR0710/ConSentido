import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { velasApi, type Fragancia } from "../api";

interface FormFragancia {
  nombre: string;
  presentacionG: number;
  precioCompra: number;
}
const FORM_VACIO: FormFragancia = { nombre: "", presentacionG: 1000, precioCompra: 0 };

/** Misma lógica de edición en línea que TablaCeras.tsx — presentación por
 *  defecto 1.000 g, igual que la tabla del PDF de costos. */
export function TablaFragancias() {
  const [fragancias, setFragancias] = useState<Fragancia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [formNuevo, setFormNuevo] = useState<FormFragancia>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEditar, setFormEditar] = useState<FormFragancia>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setFragancias(await velasApi.listarFraganciasAdmin());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar las fragancias");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicion(f: Fragancia) {
    setEditandoId(f.id);
    setFormEditar({ nombre: f.nombre, presentacionG: Number(f.presentacion_g), precioCompra: Number(f.precio_compra) });
  }

  async function guardarNuevo() {
    if (!formNuevo.nombre.trim() || formNuevo.precioCompra <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      await velasApi.crearFragancia({
        nombre: formNuevo.nombre.trim(),
        presentacionG: formNuevo.presentacionG,
        precioCompra: formNuevo.precioCompra,
      });
      setFormNuevo(FORM_VACIO);
      setAgregando(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la fragancia");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    setError(null);
    try {
      await velasApi.editarFragancia(id, {
        nombre: formEditar.nombre.trim(),
        presentacionG: formEditar.presentacionG,
        precioCompra: formEditar.precioCompra,
      });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la fragancia");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(f: Fragancia) {
    try {
      await velasApi.editarFragancia(f.id, { activo: !f.activo });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Presentación (g)</th>
              <th className="px-3 py-2">Precio compra</th>
              <th className="px-3 py-2">Valor/g</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-brand-ink/60">
                  Cargando...
                </td>
              </tr>
            ) : (
              fragancias.map((f) =>
                editandoId === f.id ? (
                  <tr key={f.id} className="border-t border-brand-vanilla-dark bg-brand-green-50/40 dark:border-brand-green-700 dark:bg-brand-green-700/10">
                    <td className="px-3 py-2">
                      <input
                        value={formEditar.nombre}
                        onChange={(e) => setFormEditar({ ...formEditar, nombre: e.target.value })}
                        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={formEditar.presentacionG || ""}
                        onChange={(e) => setFormEditar({ ...formEditar, presentacionG: Number(e.target.value) })}
                        className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={formEditar.precioCompra}
                        onChange={(v) => setFormEditar({ ...formEditar, precioCompra: v })}
                        className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2 text-brand-ink/50 dark:text-brand-vanilla/50">
                      {formEditar.presentacionG > 0 ? formatMoney(formEditar.precioCompra / formEditar.presentacionG) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-ink/50">{f.activo ? "Activo" : "Inactivo"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => guardarEdicion(f.id)}
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
                    key={f.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${f.activo ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2">{f.nombre}</td>
                    <td className="px-3 py-2">{f.presentacion_g} g</td>
                    <td className="px-3 py-2">{formatMoney(f.precio_compra)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      {formatMoney(f.valor_gramo)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          f.activo
                            ? "rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                            : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300"
                        }
                      >
                        {f.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => empezarEdicion(f)}
                          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarActivo(f)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          {f.activo ? "Desactivar" : "Activar"}
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
                    autoFocus
                    placeholder="Nombre"
                    value={formNuevo.nombre}
                    onChange={(e) => setFormNuevo({ ...formNuevo, nombre: e.target.value })}
                    className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    value={formNuevo.presentacionG || ""}
                    onChange={(e) => setFormNuevo({ ...formNuevo, presentacionG: Number(e.target.value) })}
                    className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <MoneyInput
                    value={formNuevo.precioCompra}
                    onChange={(v) => setFormNuevo({ ...formNuevo, precioCompra: v })}
                    placeholder="Precio"
                    className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2 text-brand-ink/50 dark:text-brand-vanilla/50">
                  {formNuevo.presentacionG > 0 ? formatMoney(formNuevo.precioCompra / formNuevo.presentacionG) : "—"}
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
          + Nueva fragancia
        </button>
      )}
    </div>
  );
}
