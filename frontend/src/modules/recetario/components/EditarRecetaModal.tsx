import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { SubidaImagen } from "../../../shared/components/SubidaImagen";
import { recetarioApi, type Emplatado, type Receta, type RecetarioCategoria } from "../api";
import { SelectorMedioPrincipal } from "./SelectorMedioPrincipal";

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
  onCategoriaEliminada: (id: number) => void;
}

export function EditarRecetaModal({
  receta,
  categorias,
  onCerrar,
  onGuardado,
  onMediaActualizada,
  onCategoriaCreada,
  onCategoriaEliminada,
}: EditarRecetaModalProps) {
  const [titulo, setTitulo] = useState(receta.titulo);
  const [categoriaId, setCategoriaId] = useState<number | "">(receta.categoria_id ?? "");
  const [instrucciones, setInstrucciones] = useState(receta.instrucciones);
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">(receta.video_url ? "video" : "imagen");
  const [videoUrl, setVideoUrl] = useState(receta.video_url ?? "");
  const [imagenPrincipalUrl, setImagenPrincipalUrl] = useState(receta.imagen_principal_url);
  const [emplatados, setEmplatados] = useState<Emplatado[]>(receta.emplatados);
  const [guardandoEmplatadoId, setGuardandoEmplatadoId] = useState<string | null>(null);
  const [eliminandoEmplatadoId, setEliminandoEmplatadoId] = useState<string | null>(null);
  const [confirmandoEliminarEmplatadoId, setConfirmandoEliminarEmplatadoId] = useState<string | null>(null);
  const [agregandoEmplatado, setAgregandoEmplatado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [eliminandoCategoria, setEliminandoCategoria] = useState(false);
  const [confirmandoEliminarCategoria, setConfirmandoEliminarCategoria] = useState(false);
  const [confirmandoEliminarReceta, setConfirmandoEliminarReceta] = useState(false);

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

  async function eliminarCategoria() {
    if (!categoriaId) return;
    setEliminandoCategoria(true);
    setError(null);
    try {
      await recetarioApi.eliminarCategoria(categoriaId);
      onCategoriaEliminada(categoriaId);
      setCategoriaId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la categoría");
    } finally {
      setEliminandoCategoria(false);
    }
  }

  const nombreCategoriaElegida = categorias.find((c) => c.id === categoriaId)?.nombre ?? "";

  async function subirImagenPrincipal(file: File) {
    const actualizada = await recetarioApi.subirImagenPrincipal(receta.id, file);
    setImagenPrincipalUrl(actualizada.imagen_principal_url);
    setMedioPrincipal("imagen");
    setVideoUrl("");
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
      });
      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la receta");
    } finally {
      setGuardando(false);
    }
  }

  function actualizarEmplatadoLocal(id: string, cambios: Partial<Emplatado>) {
    setEmplatados((actual) => actual.map((e) => (e.id === id ? { ...e, ...cambios } : e)));
  }

  async function agregarEmplatado() {
    setAgregandoEmplatado(true);
    setError(null);
    try {
      const nuevo = await recetarioApi.crearEmplatado(receta.id, { nombre: "Nueva presentación" });
      setEmplatados((actual) => [...actual, nuevo]);
      await onMediaActualizada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo agregar la presentación");
    } finally {
      setAgregandoEmplatado(false);
    }
  }

  async function guardarEmplatado(emplatado: Emplatado) {
    setGuardandoEmplatadoId(emplatado.id);
    setError(null);
    try {
      await recetarioApi.editarEmplatado(emplatado.id, {
        nombre: emplatado.nombre.trim() || "Presentación",
        guia: emplatado.guia?.trim() || null,
      });
      await onMediaActualizada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la presentación");
    } finally {
      setGuardandoEmplatadoId(null);
    }
  }

  async function subirImagenEmplatado(emplatado: Emplatado, file: File) {
    const actualizado = await recetarioApi.subirImagenEmplatado(emplatado.id, file);
    actualizarEmplatadoLocal(emplatado.id, { imagen_url: actualizado.imagen_url });
    await onMediaActualizada();
  }

  async function eliminarEmplatado(id: string) {
    setEliminandoEmplatadoId(id);
    setError(null);
    try {
      await recetarioApi.eliminarEmplatado(id);
      setEmplatados((actual) => actual.filter((e) => e.id !== id));
      await onMediaActualizada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la presentación");
    } finally {
      setEliminandoEmplatadoId(null);
    }
  }

  async function eliminar() {
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
    <Modal titulo="Editar receta" onCerrar={onCerrar} ancho="sm:w-[60vw]">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría</label>
      <div className="mb-2 flex gap-2">
        <select
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value ? Number(e.target.value) : "")}
          className="flex-1 rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
        >
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setConfirmandoEliminarCategoria(true)}
          disabled={!categoriaId || eliminandoCategoria}
          title="Eliminar categoría"
          aria-label="Eliminar categoría"
          className="rounded-md border border-red-300 px-2 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          🗑️
        </button>
      </div>

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
        className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />
      <p className="mb-4 mt-1 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
        ### Título, **negrilla**, *cursiva* y líneas que empiecen con "- " para viñetas.
      </p>

      <label className="mb-2 block text-xs font-medium">Medio principal</label>
      <SelectorMedioPrincipal medio={medioPrincipal} onCambiarMedio={setMedioPrincipal}>
        {medioPrincipal === "video" ? (
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
          />
        ) : (
          <SubidaImagen imagenUrl={imagenPrincipalUrl} onSubir={subirImagenPrincipal} />
        )}
      </SelectorMedioPrincipal>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Presentaciones de emplatado (opcional)
        </span>
        <p className="-mt-1 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          La misma receta se puede servir de varias formas — cada una con su propio nombre, imagen y guía. Los
          cambios de cada presentación se guardan con su propio botón.
        </p>

        {emplatados.map((e) => (
          <div
            key={e.id}
            className="flex flex-col gap-2 rounded-md border border-brand-vanilla-dark bg-brand-vanilla/40 p-3 dark:border-brand-green-700 dark:bg-brand-green-900/40"
          >
            <input
              value={e.nombre}
              onChange={(ev) => actualizarEmplatadoLocal(e.id, { nombre: ev.target.value })}
              placeholder="Nombre de la presentación (ej. Con fresas)"
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
            <SubidaImagen imagenUrl={e.imagen_url} onSubir={(file) => subirImagenEmplatado(e, file)} permitirZoom />
            <textarea
              value={e.guia ?? ""}
              onChange={(ev) => actualizarEmplatadoLocal(e.id, { guia: ev.target.value })}
              rows={2}
              placeholder="Guía de emplatado..."
              className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setConfirmandoEliminarEmplatadoId(e.id)}
                disabled={eliminandoEmplatadoId === e.id}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-60"
              >
                Eliminar esta presentación
              </button>
              <button
                type="button"
                onClick={() => guardarEmplatado(e)}
                disabled={guardandoEmplatadoId === e.id || !e.nombre.trim()}
                className="rounded-md border border-brand-green-700 px-3 py-1.5 text-xs font-semibold text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
              >
                {guardandoEmplatadoId === e.id ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        ))}

        <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          ### Título, **negrilla**, *cursiva* y líneas que empiecen con "- " para viñetas (en la guía).
        </p>
        <button
          type="button"
          onClick={agregarEmplatado}
          disabled={agregandoEmplatado}
          className="w-full rounded-md border-2 border-dashed border-brand-green-600 px-3 py-2 text-sm font-semibold text-brand-green-700 hover:bg-brand-green-50 disabled:opacity-60 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          {agregandoEmplatado ? "Agregando..." : "+ Agregar otra presentación"}
        </button>
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
        onClick={() => setConfirmandoEliminarReceta(true)}
        disabled={bloqueado}
        className="w-full rounded-md border border-red-300 px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {eliminando ? "Eliminando..." : "Eliminar receta"}
      </button>

      {confirmandoEliminarCategoria && (
        <Modal
          titulo="Eliminar categoría"
          onCerrar={() => setConfirmandoEliminarCategoria(false)}
          maxWidth="sm:max-w-sm"
          tono="advertencia"
        >
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
            ¿Eliminar la categoría <span className="font-semibold">"{nombreCategoriaElegida}"</span>? Si alguna
            receta la está usando, no se podrá eliminar hasta que se le cambie la categoría.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoEliminarCategoria(false)}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium dark:border-brand-green-700"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setConfirmandoEliminarCategoria(false);
                eliminarCategoria();
              }}
              className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700"
            >
              Sí, eliminar
            </button>
          </div>
        </Modal>
      )}

      {confirmandoEliminarEmplatadoId && (
        <Modal
          titulo="Eliminar presentación"
          onCerrar={() => setConfirmandoEliminarEmplatadoId(null)}
          maxWidth="sm:max-w-sm"
          tono="advertencia"
        >
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
            ¿Eliminar esta presentación de emplatado? Si algún producto del menú está amarrado a ella, quedará sin
            esa presentación asignada.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoEliminarEmplatadoId(null)}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium dark:border-brand-green-700"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                const id = confirmandoEliminarEmplatadoId;
                setConfirmandoEliminarEmplatadoId(null);
                eliminarEmplatado(id);
              }}
              className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700"
            >
              Sí, eliminar
            </button>
          </div>
        </Modal>
      )}

      {confirmandoEliminarReceta && (
        <Modal
          titulo="Eliminar receta"
          onCerrar={() => setConfirmandoEliminarReceta(false)}
          maxWidth="sm:max-w-sm"
          tono="advertencia"
        >
          <p className="mb-4 text-sm text-brand-ink dark:text-brand-vanilla">
            ¿Eliminar la receta <span className="font-semibold">"{receta.titulo}"</span>? Esta acción no se puede
            deshacer.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmandoEliminarReceta(false)}
              className="flex-1 rounded-md border border-brand-vanilla-dark px-4 py-3 font-medium dark:border-brand-green-700"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setConfirmandoEliminarReceta(false);
                eliminar();
              }}
              className="flex-1 rounded-md bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700"
            >
              Sí, eliminar
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
