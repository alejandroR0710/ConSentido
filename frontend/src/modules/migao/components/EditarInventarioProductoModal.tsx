import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { useAuth } from "../../../shared/auth/useAuth";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { migaoApi, type CategoriaInventario, type InventarioProducto } from "../api";

interface EditarInventarioProductoModalProps {
  producto: InventarioProducto;
  categorias: CategoriaInventario[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: CategoriaInventario) => void;
}

const campoClase =
  "w-full rounded-lg border border-brand-vanilla-dark bg-brand-vanilla px-3 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green-600 focus:ring-2 focus:ring-brand-green-600/20 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla";
const etiquetaClase = "mb-1 block text-xs font-medium text-brand-ink/80 dark:text-brand-vanilla/80";
const seccionClase =
  "mb-3 rounded-xl border border-brand-green-100 bg-brand-green-50/60 p-3 dark:border-brand-green-700/50 dark:bg-brand-green-700/10";
const seccionOpcionalClase =
  "mb-4 rounded-xl border border-dashed border-brand-vanilla-dark bg-transparent p-3 dark:border-brand-green-700";
const tituloSeccionClase =
  "mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-green-700 dark:text-brand-vanilla/70";

export function EditarInventarioProductoModal({
  producto,
  categorias,
  onCerrar,
  onGuardado,
  onCategoriaCreada,
}: EditarInventarioProductoModalProps) {
  const { usuario } = useAuth();
  // Solo Super Root puede forzar el borrado aunque el producto ya tenga
  // movimientos/recetas asociadas (el backend valida el permiso igual); a
  // cualquier otro rol el backend le sigue bloqueando ese caso.
  const esSuperRoot = usuario?.rol === "Super Root";

  const [nombre, setNombre] = useState(producto.nombre);
  const [categoriaId, setCategoriaId] = useState<number | "">(producto.categoria_id ?? "");
  const [unidadMedida, setUnidadMedida] = useState(producto.unidad_medida);
  const [unidadesPorPaquete, setUnidadesPorPaquete] = useState(Number(producto.unidades_por_paquete));
  const [tamanoUnidad, setTamanoUnidad] = useState(producto.tamano_unidad ?? "");
  const [costoPaquete, setCostoPaquete] = useState(Number(producto.costo_paquete ?? 0));
  const [stockMinimoUnidades, setStockMinimoUnidades] = useState(Number(producto.stock_minimo_unidades ?? 0));
  const [guardando, setGuardando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  const puedeGuardar = nombre.trim().length >= 2 && unidadMedida.trim().length > 0 && unidadesPorPaquete > 0;

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const categoria = await migaoApi.crearCategoriaInventario(nuevaCategoria.trim());
      onCategoriaCreada(categoria);
      setCategoriaId(categoria.id);
      setNuevaCategoria("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCreandoCategoria(false);
    }
  }

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.editarInventarioProducto(producto.id, {
        nombre: nombre.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        unidadMedida: unidadMedida.trim(),
        unidadesPorPaquete,
        tamanoUnidad: tamanoUnidad.trim() || undefined,
        costoPaquete: costoPaquete > 0 ? costoPaquete : undefined,
        stockMinimoUnidades: stockMinimoUnidades > 0 ? stockMinimoUnidades : undefined,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo() {
    setCambiandoEstado(true);
    setError(null);
    try {
      await migaoApi.editarInventarioProducto(producto.id, { activo: !producto.activo });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el producto");
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function eliminar() {
    setEliminando(true);
    setError(null);
    try {
      // Super Root fuerza el borrado (incluye movimientos/recetas asociadas,
      // de forma permanente); cualquier otro rol sigue bloqueado si el
      // producto ya tiene historial — el backend responde con ese mensaje.
      await migaoApi.eliminarInventarioProducto(producto.id, esSuperRoot);
      await onGuardado();
      onCerrar();
    } catch (err) {
      setConfirmandoEliminar(false);
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el producto");
    } finally {
      setEliminando(false);
    }
  }

  const bloqueado = guardando || cambiandoEstado || eliminando;

  return (
    <Modal titulo="Editar producto de inventario" onCerrar={onCerrar} maxWidth="sm:max-w-lg">
      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>📋</span> Información básica
        </p>
        <label className={etiquetaClase}>Nombre</label>
        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} className={campoClase} />

        <label className={`${etiquetaClase} mt-3`}>Categoría (opcional)</label>
        <select
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}
          className={`${campoClase} mb-2`}
        >
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            placeholder="Nueva categoría..."
            className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-1 text-xs text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
          <button
            type="button"
            onClick={crearCategoria}
            disabled={creandoCategoria || !nuevaCategoria.trim()}
            className="rounded-md border border-brand-green-700 px-2 py-1 text-xs text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            + Agregar
          </button>
        </div>
      </div>

      <div className={seccionClase}>
        <p className={tituloSeccionClase}>
          <span aria-hidden>📦</span> Unidades y empaque
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={etiquetaClase}>Unidad de medida</label>
            <input value={unidadMedida} onChange={(e) => setUnidadMedida(e.target.value)} className={campoClase} />
          </div>
          <div>
            <label className={etiquetaClase}>Unidades por paquete</label>
            <NumeroInput value={unidadesPorPaquete} onChange={setUnidadesPorPaquete} className={campoClase} />
          </div>
        </div>

        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-green-100 px-3 py-1 text-xs font-medium text-brand-green-700 dark:bg-brand-green-700/30 dark:text-brand-vanilla">
          <span aria-hidden>🧮</span>
          1 paquete = {unidadesPorPaquete > 0 ? unidadesPorPaquete : "?"} {unidadMedida.trim() || "unidad(es)"}
        </div>

        <label className={`${etiquetaClase} mt-3`}>Tamaño/descripción de la unidad (opcional)</label>
        <input
          value={tamanoUnidad}
          onChange={(e) => setTamanoUnidad(e.target.value)}
          placeholder='Ej. "140g"'
          className={campoClase}
        />
      </div>

      <div className={seccionOpcionalClase}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-ink/50 dark:text-brand-vanilla/50">
          ⚙️ Opcional
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={etiquetaClase}>Costo por paquete</label>
            <MoneyInput value={costoPaquete} onChange={setCostoPaquete} className={campoClase} />
          </div>
          <div>
            <label className={etiquetaClase}>Stock mínimo (unidades)</label>
            <NumeroInput value={stockMinimoUnidades} onChange={setStockMinimoUnidades} placeholder="0" className={campoClase} />
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !puedeGuardar}
        className="w-full rounded-lg bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla transition hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <div className="my-4 border-t border-dashed border-brand-vanilla-dark pt-3 dark:border-brand-green-700">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600/80">⚠ Zona de riesgo</p>

        <button
          onClick={toggleActivo}
          disabled={bloqueado}
          className={
            producto.activo
              ? "mb-2 w-full rounded-lg border border-red-300 px-4 py-3 font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
              : "mb-2 w-full rounded-lg border border-brand-green-700 px-4 py-3 font-medium text-brand-green-700 transition hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          }
        >
          {cambiandoEstado ? "Actualizando..." : producto.activo ? "Desactivar" : "Reactivar producto"}
        </button>

        <button
          onClick={() => setConfirmandoEliminar(true)}
          disabled={bloqueado}
          className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          Eliminar producto
        </button>
      </div>

      {confirmandoEliminar && (
        <Modal titulo="Eliminar producto" onCerrar={() => !eliminando && setConfirmandoEliminar(false)} maxWidth="sm:max-w-sm">
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
            ¿Seguro que quieres eliminar <span className="font-semibold">"{producto.nombre}"</span>? Esta acción no se
            puede deshacer.
            {esSuperRoot && (
              <span className="mt-2 block text-amber-700 dark:text-amber-400">
                Como Super Root, esto también borrará de forma permanente cualquier movimiento o receta ya asociada a
                este producto.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoEliminar(false)}
              disabled={eliminando}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium disabled:opacity-60 dark:border-brand-green-700"
            >
              Cancelar
            </button>
            <button
              onClick={eliminar}
              disabled={eliminando}
              className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {eliminando ? "Eliminando..." : "Sí, eliminar"}
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
