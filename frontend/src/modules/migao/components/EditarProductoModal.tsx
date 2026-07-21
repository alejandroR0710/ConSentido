import { useEffect, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { MoneyInput } from "../../../shared/components/MoneyInput";
import { SubidaImagen } from "../../../shared/components/SubidaImagen";
import { migaoApi, type CategoriaProducto, type InventarioProducto, type ProductoAdmin } from "../api";
import { SelectorIngredientes, type FilaIngrediente } from "./SelectorIngredientes";

interface EditarProductoModalProps {
  producto: ProductoAdmin;
  categorias: CategoriaProducto[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: CategoriaProducto) => void;
}

/** Editar nombre/precio/categoría, subir/cambiar su foto, o "eliminar" el producto
 *  del menú — en realidad lo desactiva (activo:false), nunca se borra físicamente
 *  porque puede estar referenciado por órdenes o ventas ya cerradas. Reactivar
 *  es el mismo botón. */
export function EditarProductoModal({
  producto,
  categorias,
  onCerrar,
  onGuardado,
  onCategoriaCreada,
}: EditarProductoModalProps) {
  const [nombre, setNombre] = useState(producto.nombre);
  const [precio, setPrecio] = useState(Number(producto.precio));
  const [categoriaId, setCategoriaId] = useState<number | "">(producto.categoria_id ?? "");
  const [descripcion, setDescripcion] = useState(producto.descripcion ?? "");
  const [imagenUrl, setImagenUrl] = useState(producto.imagen_url);
  const [guardando, setGuardando] = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  const [inventario, setInventario] = useState<InventarioProducto[]>([]);
  const [ingredientes, setIngredientes] = useState<FilaIngrediente[]>([]);

  useEffect(() => {
    migaoApi.listarInventario().then(setInventario).catch(() => {});
    migaoApi
      .obtenerIngredientesProducto(producto.id)
      .then((lista) =>
        setIngredientes(
          lista.map((i) => ({ inventarioProductoId: i.inventarioProductoId, cantidadPorUnidad: Number(i.cantidadPorUnidad) })),
        ),
      )
      .catch(() => {
        /* la receta simplemente queda vacía si no se pudo cargar */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.id]);

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

  async function guardar() {
    if (!nombre.trim() || precio <= 0) return;
    setGuardando(true);
    setError(null);
    try {
      await migaoApi.editarProducto(producto.id, {
        nombre: nombre.trim(),
        precio,
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        descripcion: descripcion.trim() || undefined,
      });
      await migaoApi.guardarIngredientesProducto(producto.id, ingredientes);
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
      await migaoApi.editarProducto(producto.id, { activo: !producto.activo });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el producto");
    } finally {
      setCambiandoEstado(false);
    }
  }

  async function subirFoto(file: File) {
    const actualizado = await migaoApi.subirImagenProducto(producto.id, file);
    setImagenUrl(actualizado.imagen_url);
    await onGuardado();
  }

  const bloqueado = guardando || cambiandoEstado;

  return (
    <Modal titulo="Editar producto" onCerrar={onCerrar}>
      <SubidaImagen imagenUrl={imagenUrl} onSubir={subirFoto} />

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
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría</label>
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

      <SelectorIngredientes inventario={inventario} value={ingredientes} onChange={setIngredientes} />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !nombre.trim() || precio <= 0}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <button
        onClick={toggleActivo}
        disabled={bloqueado}
        className={
          producto.activo
            ? "w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            : "w-full rounded-md border border-brand-green-700 px-4 py-3 font-medium text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        }
      >
        {cambiandoEstado ? "Actualizando..." : producto.activo ? "Eliminar del menú" : "Reactivar producto"}
      </button>
    </Modal>
  );
}
