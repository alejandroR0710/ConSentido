import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SubidaImagen } from "../../../shared/components/SubidaImagen";
import { insumosApi, type Insumo } from "../api";

interface EditarInsumoModalProps {
  insumo: Insumo;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}

/** Editar datos del insumo, subir/cambiar su foto, o "eliminarlo" (desactivar,
 *  activo:false) — nunca se borra físicamente porque puede estar referenciado
 *  por movimientos de inventario ya registrados. Reactivar es el mismo botón. */
export function EditarInsumoModal({ insumo, onCerrar, onGuardado }: EditarInsumoModalProps) {
  const [nombre, setNombre] = useState(insumo.nombre);
  const [unidadMedida, setUnidadMedida] = useState(insumo.unidadMedida);
  const [stockMinimo, setStockMinimo] = useState(Number(insumo.stockMinimo));
  const [costoUnitario, setCostoUnitario] = useState(Number(insumo.costoUnitario));
  const [descripcion, setDescripcion] = useState(insumo.descripcion ?? "");
  const [imagenUrl, setImagenUrl] = useState(insumo.imagenUrl);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    if (!nombre.trim() || !unidadMedida.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await insumosApi.editar(insumo.id, {
        nombre: nombre.trim(),
        unidadMedida: unidadMedida.trim(),
        stockMinimo,
        costoUnitario,
        descripcion: descripcion.trim() || undefined,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el insumo");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo() {
    setCambiandoEstado(true);
    setError(null);
    try {
      await insumosApi.editar(insumo.id, { activo: !insumo.activo });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el insumo");
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function subirFoto(file: File) {
    const actualizado = await insumosApi.subirImagen(insumo.id, file);
    setImagenUrl(actualizado.imagenUrl);
    await onGuardado();
  }

  const bloqueado = guardando || cambiandoEstado;

  return (
    <Modal titulo="Editar insumo" onCerrar={onCerrar}>
      <SubidaImagen imagenUrl={imagenUrl} onSubir={subirFoto} />

      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Unidad de medida</label>
      <input
        value={unidadMedida}
        onChange={(e) => setUnidadMedida(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Stock mínimo</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={stockMinimo}
            onChange={(e) => setStockMinimo(Number(e.target.value))}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Costo unitario</label>
          <MoneyInput
            value={costoUnitario}
            onChange={setCostoUnitario}
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        </div>
      </div>

      <label className="mb-1 block text-xs font-medium">Descripción (opcional)</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={3}
        className="mb-4 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !nombre.trim() || !unidadMedida.trim()}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <button
        onClick={toggleActivo}
        disabled={bloqueado}
        className={
          insumo.activo
            ? "w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            : "w-full rounded-md border border-brand-green-700 px-4 py-3 font-medium text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        }
      >
        {cambiandoEstado ? "Actualizando..." : insumo.activo ? "Eliminar insumo" : "Reactivar insumo"}
      </button>
    </Modal>
  );
}
