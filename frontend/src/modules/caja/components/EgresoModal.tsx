import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SelectorMetodoPago, type MetodoPagoValor } from "../../../shared/components/SelectorMetodoPago";
import { cajaApi, type CategoriaGasto, type ModuloOrigenSlug, type Proveedor } from "../api";
import { MODULOS_ORIGEN } from "../moduloOrigen";

// Solo para el selector de "Área" de ESTE modal (Registrar egreso) — Con
// Sentido ya abarca insumos/talleres/pedidos a efectos de reportar un gasto
// (todo lo que no es Migao), así que ofrecerlos sueltos acá sería
// redundante. El resto de pantallas sigue usando MODULOS_ORIGEN completo.
const AREAS_EGRESO = MODULOS_ORIGEN.filter((m) => m.value === "con_sentido" || m.value === "migao");

interface EgresoModalProps {
  categorias: CategoriaGasto[];
  onCategoriaCreada: (categoria: CategoriaGasto) => void;
  onCerrar: () => void;
  onRegistrado: () => Promise<void>;
}

export function EgresoModal({ categorias, onCategoriaCreada, onCerrar, onRegistrado }: EgresoModalProps) {
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [moduloOrigenSlug, setModuloOrigenSlug] = useState<ModuloOrigenSlug | "">("");
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

  // Cargar proveedores al abrir el modal
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
      setProveedores((prev) => [...prev, nuevo]);
      setProveedorId(nuevo.id);
      setNuevoProveedorNombre("");
      setCreandoProveedor(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proveedor");
    } finally {
      setGuardandoProveedor(false);
    }
  }

  const mixtoInvalido = pago.metodoPago === "mixto" && pago.montoEfectivo + pago.montoBanco <= 0;
  const puedeRegistrar =
    Boolean(categoriaId) && Boolean(moduloOrigenSlug) && motivo.trim().length > 0 && (pago.metodoPago === "mixto" ? !mixtoInvalido : monto > 0);

  async function registrar() {
    if (!categoriaId || !moduloOrigenSlug || !puedeRegistrar) return;
    setRegistrando(true);
    setError(null);
    try {
      await cajaApi.registrarEgreso({
        categoriaGastoId: Number(categoriaId),
        motivo: motivo.trim(),
        proveedorId: proveedorId || undefined,
        moduloOrigenSlug,
        ...(pago.metodoPago === "mixto" ? pago : { metodoPago: pago.metodoPago, monto }),
      });
      await onRegistrado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el egreso");
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <Modal titulo="Registrar egreso" onCerrar={onCerrar} ancho="sm:w-[60vw]">
      <label className="mb-1 block text-xs font-medium">Área</label>
      <select
        autoFocus
        value={moduloOrigenSlug}
        onChange={(e) => setModuloOrigenSlug(e.target.value as ModuloOrigenSlug | "")}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="" disabled>
          Selecciona un área
        </option>
        {AREAS_EGRESO.map((m) => (
          <option key={m.value} value={m.value}>
            {m.icon} {m.label}
          </option>
        ))}
      </select>

      {/* Categoría y Proveedor comparten fila al 50/50. Cada uno tiene un
          "+ Nueva/Nuevo" para crearlo sin salir de este modal — ya no hace
          falta ir a Administración. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium">Categoría de gasto</label>
            {!creandoCategoria && (
              <button
                type="button"
                onClick={() => setCreandoCategoria(true)}
                className="text-xs font-medium text-brand-green-700 underline hover:text-brand-green-600 dark:text-brand-vanilla dark:hover:text-brand-vanilla/80"
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
                className="shrink-0 rounded-md bg-brand-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
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
              value={categoriaId}
              onChange={(e) => setCategoriaId(Number(e.target.value))}
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
                className="text-xs font-medium text-brand-green-700 underline hover:text-brand-green-600 dark:text-brand-vanilla dark:hover:text-brand-vanilla/80"
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
                className="shrink-0 rounded-md bg-brand-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-green-700 disabled:opacity-60"
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
              {proveedores.map((p) => (
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
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {registrando ? "Registrando..." : "Registrar egreso"}
      </button>
    </Modal>
  );
}
