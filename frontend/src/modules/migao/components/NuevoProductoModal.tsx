import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { migaoApi, type CategoriaProducto } from "../api";

interface NuevoProductoModalProps {
  categorias: CategoriaProducto[];
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: CategoriaProducto) => void;
}

export function NuevoProductoModal({
  categorias,
  onCerrar,
  onCreado,
  onCategoriaCreada,
}: NuevoProductoModalProps) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState(0);
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [descripcion, setDescripcion] = useState("");
  const [esParaLlevar, setEsParaLlevar] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const categoria = await migaoApi.crearCategoria(nuevaCategoria.trim());
      onCategoriaCreada(categoria);
      setCategoriaId(categoria.id);
      setNuevaCategoria("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCreandoCategoria(false);
    }
  }

  async function crear() {
    if (!nombre.trim() || precio <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await migaoApi.crearProducto({
        nombre: nombre.trim(),
        precio,
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        descripcion: descripcion.trim() || undefined,
        esParaLlevar,
      });
      await onCreado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el producto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal titulo="Nuevo producto" onCerrar={onCerrar}>
      <label className="mb-1 block text-xs font-medium">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Precio</label>
      <MoneyInput
        value={precio}
        onChange={setPrecio}
        placeholder="0"
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría (opcional)</label>
      <select
        value={categoriaId}
        onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}
        className="mb-2 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      >
        <option value="">Sin categoría</option>
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>

      <div className="mb-4 flex gap-2">
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

      <label className="mb-1 block text-xs font-medium">Descripción (opcional)</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={3}
        placeholder="Ej. Jarra personal de chocolate caliente, queso, almojábana..."
        className="mb-4 w-full resize-none rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-4 flex items-center gap-2 text-sm text-brand-ink dark:text-brand-vanilla">
        <input
          type="checkbox"
          checked={esParaLlevar}
          onChange={(e) => setEsParaLlevar(e.target.checked)}
          className="h-4 w-4"
        />
        Es para llevar (envase / cargo adicional)
      </label>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={crear}
        disabled={submitting || !nombre.trim() || precio <= 0}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Creando..." : "Crear producto"}
      </button>
    </Modal>
  );
}
