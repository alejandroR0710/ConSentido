import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { formatMoney } from "../../../shared/format/money";
import { velasApi, type Pabilo } from "../api";

interface FormPabilo {
  talla: string;
  longitudM: number;
  precioCarrete: number;
}
const FORM_VACIO: FormPabilo = { talla: "", longitudM: 0, precioCarrete: 0 };

export function TablaPabilos() {
  const [pabilos, setPabilos] = useState<Pabilo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [formNuevo, setFormNuevo] = useState<FormPabilo>(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formEditar, setFormEditar] = useState<FormPabilo>(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      setPabilos(await velasApi.listarPabilosAdmin());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar los pabilos");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicion(p: Pabilo) {
    setEditandoId(p.id);
    setFormEditar({ talla: p.talla, longitudM: Number(p.longitud_m), precioCarrete: Number(p.precio_carrete) });
  }

  async function guardarNuevo() {
    if (!formNuevo.talla.trim() || formNuevo.longitudM <= 0 || formNuevo.precioCarrete <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      await velasApi.crearPabilo({
        talla: formNuevo.talla.trim(),
        longitudM: formNuevo.longitudM,
        precioCarrete: formNuevo.precioCarrete,
      });
      setFormNuevo(FORM_VACIO);
      setAgregando(false);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el pabilo");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarEdicion(id: string) {
    setGuardando(true);
    setError(null);
    try {
      await velasApi.editarPabilo(id, {
        talla: formEditar.talla.trim(),
        longitudM: formEditar.longitudM,
        precioCarrete: formEditar.precioCarrete,
      });
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el pabilo");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(p: Pabilo) {
    try {
      await velasApi.editarPabilo(p.id, { activo: !p.activo });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-brand-vanilla-dark dark:border-brand-green-700">
        <table className="w-full min-w-[440px] text-left text-sm">
          <thead className="bg-brand-green-50 text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
            <tr>
              <th className="px-3 py-2">Talla</th>
              <th className="px-3 py-2">Longitud carrete (m)</th>
              <th className="px-3 py-2">Precio</th>
              <th className="px-3 py-2">Valor/cm</th>
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
              pabilos.map((p) =>
                editandoId === p.id ? (
                  <tr key={p.id} className="border-t border-brand-vanilla-dark bg-brand-green-50/40 dark:border-brand-green-700 dark:bg-brand-green-700/10">
                    <td className="px-3 py-2">
                      <input
                        value={formEditar.talla}
                        onChange={(e) => setFormEditar({ ...formEditar, talla: e.target.value })}
                        className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={formEditar.longitudM || ""}
                        onChange={(e) => setFormEditar({ ...formEditar, longitudM: Number(e.target.value) })}
                        className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <MoneyInput
                        value={formEditar.precioCarrete}
                        onChange={(v) => setFormEditar({ ...formEditar, precioCarrete: v })}
                        className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                      />
                    </td>
                    <td className="px-3 py-2 text-brand-ink/50 dark:text-brand-vanilla/50">
                      {formEditar.longitudM > 0 ? formatMoney(formEditar.precioCarrete / formEditar.longitudM / 100) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-ink/50">{p.activo ? "Activo" : "Inactivo"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => guardarEdicion(p.id)}
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
                    key={p.id}
                    className={`border-t border-brand-vanilla-dark dark:border-brand-green-700 ${p.activo ? "" : "opacity-50"}`}
                  >
                    <td className="px-3 py-2 font-medium">{p.talla}</td>
                    <td className="px-3 py-2">{p.longitud_m} m</td>
                    <td className="px-3 py-2">{formatMoney(p.precio_carrete)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-green-700 dark:text-brand-vanilla">
                      {formatMoney(p.valor_cm)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          p.activo
                            ? "rounded-full bg-brand-green-50 px-2 py-0.5 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla"
                            : "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300"
                        }
                      >
                        {p.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => empezarEdicion(p)}
                          className="rounded-md border border-brand-green-700 px-2 py-1 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => alternarActivo(p)}
                          className="rounded-md border border-brand-vanilla-dark px-2 py-1 text-xs text-brand-ink/70 hover:bg-brand-green-50 dark:border-brand-green-700 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
                        >
                          {p.activo ? "Desactivar" : "Activar"}
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
                    placeholder="Talla"
                    value={formNuevo.talla}
                    onChange={(e) => setFormNuevo({ ...formNuevo, talla: e.target.value })}
                    className="w-16 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    value={formNuevo.longitudM || ""}
                    onChange={(e) => setFormNuevo({ ...formNuevo, longitudM: Number(e.target.value) })}
                    className="w-24 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2">
                  <MoneyInput
                    value={formNuevo.precioCarrete}
                    onChange={(v) => setFormNuevo({ ...formNuevo, precioCarrete: v })}
                    placeholder="Precio"
                    className="w-28 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-sm dark:border-brand-green-700 dark:bg-brand-green-900"
                  />
                </td>
                <td className="px-3 py-2 text-brand-ink/50 dark:text-brand-vanilla/50">
                  {formNuevo.longitudM > 0 ? formatMoney(formNuevo.precioCarrete / formNuevo.longitudM / 100) : "—"}
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
          + Nuevo pabilo
        </button>
      )}
    </div>
  );
}
