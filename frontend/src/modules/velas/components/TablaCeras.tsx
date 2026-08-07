import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { velasApi, type Cera } from "../api";

interface FormCera {
  nombre: string;
  presentacionKg: number;
  precioCompra: number;
  proveedor: string;
}
const FORM_VACIO: FormCera = { nombre: "", presentacionKg: 0, precioCompra: 0, proveedor: "" };

/** Tabla editable de ceras: agregar/editar en línea, sin modal — pensada
 *  para actualizar precios rápido cuando cambia una compra. `valor_gramo` es
 *  columna calculada en la base (GENERATED ALWAYS), nunca se edita a mano. */
export function TablaCeras() {
  const [ceras, setCeras] = useState<Cera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [formNuevo, setFormNuevo] = useState<FormCera>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEditar, setFormEditar] = useState<FormCera>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setCeras(await velasApi.listarCerasAdmin());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar las ceras");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicion(c: Cera) {
    setEditandoId(c.id);
    setFormEditar({
      nombre: c.nombre,
      presentacionKg: Number(c.presentacion_kg),
      precioCompra: Number(c.precio_compra),
      proveedor: c.proveedor ?? "",
    });
  }

  async function guardarNuevo() {
    if (!formNuevo.nombre.trim() || formNuevo.presentacionKg <= 0 || formNuevo.precioCompra <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      await velasApi.crearCera({
        nombre: formNuevo.nombre.trim(),
        presentacionKg: formNuevo.presentacionKg,
        precioCompra: formNuevo.precioCompra,
        proveedor: formNuevo.proveedor.trim() || undefined,
      });
      setFormNuevo(FORM_VACIO);
      setAgregando(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la cera");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    setError(null);
    try {
      await velasApi.editarCera(id, {
        nombre: formEditar.nombre.trim(),
        presentacionKg: formEditar.presentacionKg,
        precioCompra: formEditar.precioCompra,
        proveedor: formEditar.proveedor.trim() || undefined,
      });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la cera");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(c: Cera) {
    try {
      await velasApi.editarCera(c.id, { activo: !c.activo });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Presentación (kg)</th>
              <th className="px-3 py-2">Precio compra</th>
              <th className="px-3 py-2">Valor/g</th>
              <th className="px-3 py-2">Proveedor</th>
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
              ceras.map((c) =>
                editandoId === c.id ? (
                  <tr key={c.id} className="border-t border-brand-vanilla-dark bg-brand-green-50/40 dark:border-brand-green-700 dark:bg-brand-green-700/10">
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
                        step="0.001"
                        value={formEditar.presentacionKg || ""}
                        onChange={(e) => setFormEditar({ ...formEditar, presentacionKg: Number(e.target.value) })}
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
                      {formEditar.presentacionKg > 0
                        ? formatMoney(formEditar.precioCompra / formEditar.presentacionKg / 1000)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={formEditar.proveedor}
                        onChange={(e) => setFormEditar({ ...formEditar, proveedor: e.target.value })}
                        className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-ink/50">{c.activo ? "Activo" : "Inactivo"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => guardarEdicion(c.id)}
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
                    key={c.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${c.activo ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2">{c.nombre}</td>
                    <td className="px-3 py-2">{c.presentacion_kg} kg</td>
                    <td className="px-3 py-2">{formatMoney(c.precio_compra)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      {formatMoney(c.valor_gramo)}
                    </td>
                    <td className="px-3 py-2">{c.proveedor ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          c.activo
                            ? "rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                            : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300"
                        }
                      >
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => empezarEdicion(c)}
                          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarActivo(c)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          {c.activo ? "Desactivar" : "Activar"}
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
                    step="0.001"
                    placeholder="kg"
                    value={formNuevo.presentacionKg || ""}
                    onChange={(e) => setFormNuevo({ ...formNuevo, presentacionKg: Number(e.target.value) })}
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
                  {formNuevo.presentacionKg > 0 ? formatMoney(formNuevo.precioCompra / formNuevo.presentacionKg / 1000) : "—"}
                </td>
                <td className="px-3 py-2">
                  <input
                    placeholder="Proveedor (opcional)"
                    value={formNuevo.proveedor}
                    onChange={(e) => setFormNuevo({ ...formNuevo, proveedor: e.target.value })}
                    className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
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
          + Nueva cera
        </button>
      )}
    </div>
  );
}
