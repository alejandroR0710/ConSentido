import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SubidaImagen } from "../../../shared/components/SubidaImagen";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

interface EditarRecetaModalProps {
  receta: Receta;
  categorias: RecetarioCategoria[];
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
  // Solo refresca la lista del admin, sin cerrar este modal — a diferencia
  // de onGuardado (que cierra), subir una imagen no debe botar al usuario
  // del formulario y perder el título/instrucciones que ya haya escrito sin
  // guardar.
  onMediaActualizada: () => Promise<void> | void;
  onCategoriaCreada: (categoria: RecetarioCategoria) => void;
}

const OPCIONES_MEDIO = [
  { valor: "imagen" as const, etiqueta: "Imagen" },
  { valor: "video" as const, etiqueta: "Video" },
];

export function EditarRecetaModal({
  receta,
  categorias,
  onCerrar,
  onGuardado,
  onMediaActualizada,
  onCategoriaCreada,
}: EditarRecetaModalProps) {
  const [titulo, setTitulo] = useState(receta.titulo);
  const [categoriaId, setCategoriaId] = useState<number | "">(receta.categoria_id ?? "");
  const [instrucciones, setInstrucciones] = useState(receta.instrucciones);
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">(receta.video_url ? "video" : "imagen");
  const [videoUrl, setVideoUrl] = useState(receta.video_url ?? "");
  const [imagenPrincipalUrl, setImagenPrincipalUrl] = useState(receta.imagen_principal_url);
  const [imagenEmplatadoUrl, setImagenEmplatadoUrl] = useState(receta.imagen_emplatado_url);
  const [descripcionEmplatado, setDescripcionEmplatado] = useState(receta.descripcion_emplatado ?? "");
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    setCreandoCategoria(true);
    setError(null);
    try {
      const categoria = await recetarioApi.crearCategoria(nuevaCategoria.trim());
      onCategoriaCreada(categoria);
      setCategoriaId(categoria.id);
      setNuevaCategoria("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setCreandoCategoria(false);
    }
  }

  async function subirImagenPrincipal(file: File) {
    const actualizada = await recetarioApi.subirImagenPrincipal(receta.id, file);
    setImagenPrincipalUrl(actualizada.imagen_principal_url);
    setMedioPrincipal("imagen");
    setVideoUrl("");
    await onMediaActualizada();
  }

  async function subirImagenEmplatado(file: File) {
    const actualizada = await recetarioApi.subirImagenEmplatado(receta.id, file);
    setImagenEmplatadoUrl(actualizada.imagen_emplatado_url);
    await onMediaActualizada();
  }

  async function guardar() {
    if (!titulo.trim() || !instrucciones.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await recetarioApi.editar(receta.id, {
        titulo: titulo.trim(),
        instrucciones: instrucciones.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : null,
        videoUrl: medioPrincipal === "video" ? videoUrl.trim() || null : undefined,
        descripcionEmplatado: descripcionEmplatado.trim() || null,
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la receta");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar la receta "${receta.titulo}"? Esta acción no se puede deshacer.`)) return;
    setEliminando(true);
    setError(null);
    try {
      await recetarioApi.eliminar(receta.id);
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la receta");
    } finally {
      setEliminando(false);
    }
  }

  const bloqueado = guardando || eliminando;

  return (
    <Modal titulo="Editar receta" onCerrar={onCerrar} maxWidth="sm:max-w-xl">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
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

      <label className="mb-1 block text-xs font-medium">Instrucciones</label>
      <textarea
        value={instrucciones}
        onChange={(e) => setInstrucciones(e.target.value)}
        rows={6}
        className="mb-4 w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-2 block text-xs font-medium">Medio principal</label>
      <div className="mb-3 flex rounded-lg border border-brand-vanilla-dark p-1 dark:border-brand-green-700">
        {OPCIONES_MEDIO.map((op) => (
          <button
            key={op.valor}
            type="button"
            onClick={() => setMedioPrincipal(op.valor)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              medioPrincipal === op.valor
                ? "bg-brand-green-600 text-white"
                : "text-brand-ink/70 hover:bg-brand-green-50 dark:text-brand-vanilla/70 dark:hover:bg-brand-green-700/40"
            }`}
          >
            {op.etiqueta}
          </button>
        ))}
      </div>

      {medioPrincipal === "video" ? (
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://..."
          className="mb-4 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      ) : (
        <SubidaImagen imagenUrl={imagenPrincipalUrl} onSubir={subirImagenPrincipal} />
      )}

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Ejemplo de emplatado (opcional)
        </span>
        <SubidaImagen imagenUrl={imagenEmplatadoUrl} onSubir={subirImagenEmplatado} />
        <textarea
          value={descripcionEmplatado}
          onChange={(e) => setDescripcionEmplatado(e.target.value)}
          rows={2}
          placeholder="Detalles de cómo servirlo..."
          className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        />
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={guardar}
        disabled={bloqueado || !titulo.trim() || !instrucciones.trim()}
        className="mb-2 w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <button
        onClick={eliminar}
        disabled={bloqueado}
        className="w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {eliminando ? "Eliminando..." : "Eliminar receta"}
      </button>
    </Modal>
  );
}
