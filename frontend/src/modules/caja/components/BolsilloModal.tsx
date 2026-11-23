import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { cajaApi, type CategoriaGasto, type Proveedor } from "../api";

interface BolsilloModalProps {
  categorias: CategoriaGasto[];
  onCategoriaCreada: (categoria: CategoriaGasto) => void;
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

/**
 * "Bolsillo": plata personal/del dueño — mismo formulario que Registrar
 * egreso, pero SIN el selector de Área (no aplica, no es gasto de ninguna
 * operación puntual). Queda guardado en el turno activo (se ve en
 * Movimientos del turno, en morado) pero no afecta su cuadre de efectivo/
 * banco — solo resta del Acumulado Total (ver caja.service.ts::registrarBolsillo).
 */
export function BolsilloModal({ categorias, onCategoriaCreada, onCerrar, onRegistrado }: BolsilloModalProps) {
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [proveedorId, setProveedorId] = useState<string>("");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [monto, setMonto] = useState(0);
  const [pago, setPago] = useState<MetodoPagoValor>({ metodoPago: "efectivo" });
  const [motivo, setMotivo] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState("");
  const [guardandoCategoria, setGuardandoCategoria] = useState(false);

  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [nuevoProveedorNombre, setNuevoProveedorNombre] = useState("");
  const [guardandoProveedor, setGuardandoProveedor] = useState(false);

  useEffect(() => {
    cargarProveedores();
  }, []);

  async function cargarProveedores() {
    try {
      const provs = await cajaApi.listarProveedores();
      setProveedores(provs);
    } catch {
      // Sin proveedores disponibles, el campo es opcional
    }
  }

  async function crearCategoriaInline() {
    if (!nuevaCategoriaNombre.trim()) return;
    setGuardandoCategoria(true);
    setError(null);
    try {
      const nueva = await cajaApi.crearCategoriaGasto(nuevaCategoriaNombre.trim());
      onCategoriaCreada(nueva);
      setCategoriaId(nueva.id);
      setNuevaCategoriaNombre("");
      setCreandoCategoria(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setGuardandoCategoria(false);
    }
  }

  async function crearProveedorInline() {
    if (!nuevoProveedorNombre.trim()) return;
    setGuardandoProveedor(true);
    setError(null);
    try {
      const nuevo = await cajaApi.crearProveedor(nuevoProveedorNombre.trim());
      let categoriaIds: number[] = [];
      if (categoriaId !== "") {
        const anclados = proveedores.filter((p) => p.categoria_ids.includes(categoriaId));
        if (anclados.length > 0) {
          await cajaApi.anclarProveedoresACategoria(categoriaId, [...anclados.map((p) => p.id), nuevo.id]);
          categoriaIds = [categoriaId];
        }
      }
      setProveedores((prev) => [...prev, { ...nuevo, categoria_ids: categoriaIds }]);
      setProveedorId(nuevo.id);
      setNuevoProveedorNombre("");
      setCreandoProveedor(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proveedor");
    } finally {
      setGuardandoProveedor(false);
    }
  }

  function proveedorValidoParaCategoria(p: Proveedor, catId: number | "") {
    if (catId === "") return true;
    const anclados = proveedores.filter((x) => x.categoria_ids.includes(catId));
    return anclados.length === 0 || p.categoria_ids.includes(catId);
  }

  const proveedoresFiltrados = proveedores.filter((p) => proveedorValidoParaCategoria(p, categoriaId));

  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  const puedeRegistrar = Boolean(categoriaId) && motivo.trim().length > 0 && (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0);

  async function registrar() {
    if (!categoriaId || !puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarBolsillo({
        categoriaGastoId: Number(categoriaId),
        motivo: motivo.trim(),
        proveedorId: proveedorId || undefined,
        ...(pago.metodoPago === "mixto" ? pago : { metodoPago: pago.metodoPago, monto }),
      });
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el bolsillo");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo="🟣 Bolsillo" onCerrar={onCerrar} ancho="sm:w-[60vw]">
      <p className="mb-3 rounded-md bg-purple-50 px-3 py-2 text-xs text-purple-700 dark:bg-purple-950/30 dark:text-purple-400">
        Plata personal/del dueño: no afecta el efectivo ni el banco que se cuenta al cerrar este turno, solo resta
        del Acumulado Total de la tienda.
      </p>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium">Categoría de gasto</label>
            {!creandoCategoria && (
              <button
                type="button"
                onClick={() => setCreandoCategoria(true)}
                className="text-xs font-medium text-purple-700 underline hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300"
              >
                + Nueva
              </button>
            )}
          </div>
          {creandoCategoria ? (
            <div className="mb-1 flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Nombre de la categoría"
                value={nuevaCategoriaNombre}
                onChange={(e) => setNuevaCategoriaNombre(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crearCategoriaInline()}
                className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <button
                type="button"
                onClick={crearCategoriaInline}
                disabled={guardandoCategoria || !nuevaCategoriaNombre.trim()}
                className="shrink-0 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {guardandoCategoria ? "..." : "Agregar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreandoCategoria(false);
                  setNuevaCategoriaNombre("");
                }}
                className="shrink-0 text-xs text-brand-ink/60 underline hover:text-brand-ink dark:text-brand-vanilla/60 dark:hover:text-brand-vanilla"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <select
              autoFocus
              value={categoriaId}
              onChange={(e) => {
                const nuevaCategoriaId = Number(e.target.value);
                setCategoriaId(nuevaCategoriaId);
                const proveedorActual = proveedores.find((p) => p.id === proveedorId);
                if (!proveedorActual || !proveedorValidoParaCategoria(proveedorActual, nuevaCategoriaId)) {
                  setProveedorId("");
                }
              }}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            >
              <option value="" disabled>
                Selecciona una categoría
              </option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium">Proveedor (opcional)</label>
            {!creandoProveedor && (
              <button
                type="button"
                onClick={() => setCreandoProveedor(true)}
                className="text-xs font-medium text-purple-700 underline hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-300"
              >
                + Nuevo
              </button>
            )}
          </div>
          {creandoProveedor ? (
            <div className="mb-1 flex gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Nombre del proveedor"
                value={nuevoProveedorNombre}
                onChange={(e) => setNuevoProveedorNombre(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crearProveedorInline()}
                className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
              />
              <button
                type="button"
                onClick={crearProveedorInline}
                disabled={guardandoProveedor || !nuevoProveedorNombre.trim()}
                className="shrink-0 rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {guardandoProveedor ? "..." : "Agregar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreandoProveedor(false);
                  setNuevoProveedorNombre("");
                }}
                className="shrink-0 text-xs text-brand-ink/60 underline hover:text-brand-ink dark:text-brand-vanilla/60 dark:hover:text-brand-vanilla"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <select
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            >
              <option value="">Sin proveedor</option>
              {proveedoresFiltrados.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Motivo</label>
      <textarea
        required
        rows={3}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        className="mb-3 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {pago.metodoPago !== "mixto" && (
        <>
          <label className="mb-1 block text-xs font-medium">Monto</label>
          <MoneyInput
            value={monto}
            onChange={setMonto}
            className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </>
      )}

      <label className="mb-1 block text-xs font-medium">Método</label>
      <div className="mb-3">
        <SelectorMetodoPago value={pago} onChange={setPago} pedirReferenciaBanco={false} />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={registrar}
        disabled={registrando || !puedeRegistrar}
        className="w-full rounded-md bg-purple-600 px-4 py-3 font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "🟣 Registrar bolsillo"}
      </button>
    </Modal>
  );
}
