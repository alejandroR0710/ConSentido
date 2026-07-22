import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { NumeroInput } from "../../../shared/components/NumeroInput";
import { migaoApi, type InventarioProducto } from "../api";

interface EditarInventarioProductoModalProps {
  producto: InventarioProducto;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

export function EditarInventarioProductoModal({ producto, onCerrar, onGuardado }: EditarInventarioProductoModalProps) {
  const [nombre, setNombre] = useState(producto.nombre);
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

  const puedeGuardar = nombre.trim().length >= 2 && unidadMedida.trim().length > 0 && unidadesPorPaquete > 0;

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.editarInventarioProducto(producto.id, {
        nombre: nombre.trim(),
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
    if (!confirmandoEliminar) {
      setConfirmandoEliminar(true);
      return;
    }
    setEliminando(true);
    setError(null);
    try {
      await migaoApi.eliminarInventarioProducto(producto.id);
      await onGuardado();
      onCerrar();
    } catch (err) {
      // El backend rechaza el borrado si ya tiene movimientos o recetas
      // asociadas (usa "Desactivar" en ese caso) — el mensaje ya lo explica.
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el producto");
      setConfirmandoEliminar(false);
    } finally {
      setEliminando(false);
    }
  }

  const bloqueado = guardando || cambiandoEstado || eliminando;

  return (
    <Modal titulo="Editar producto de inventario" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Unidad de medida</label>
          <input
            value={unidadMedida}
            onChange={(e) => setUnidadMedida(e.target.value)}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Unidades por paquete</label>
          <NumeroInput
            value={unidadesPorPaquete}
            onChange={setUnidadesPorPaquete}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Tamaño/descripción de la unidad (opcional)</label>
      <input
        value={tamanoUnidad}
        onChange={(e) => setTamanoUnidad(e.target.value)}
        placeholder='Ej. "140g"'
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Costo por paquete (opcional)</label>
          <MoneyInput
            value={costoPaquete}
            onChange={setCostoPaquete}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Stock mínimo en unidades (opcional)</label>
          <NumeroInput
            value={stockMinimoUnidades}
            onChange={setStockMinimoUnidades}
            placeholder="0"
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !puedeGuardar}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <button
        onClick={toggleActivo}
        disabled={bloqueado}
        className={
          producto.activo
            ? "mb-2 w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            : "mb-2 w-full rounded-md border border-brand-green-700 px-4 py-3 font-medium text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        }
      >
        {cambiandoEstado ? "Actualizando..." : producto.activo ? "Desactivar" : "Reactivar producto"}
      </button>

      <button
        onClick={eliminar}
        disabled={bloqueado}
        className="w-full rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60"
      >
        {eliminando ? "Eliminando..." : confirmandoEliminar ? "¿Seguro? Toca de nuevo para eliminar" : "Eliminar producto"}
      </button>
    </Modal>
  );
}
