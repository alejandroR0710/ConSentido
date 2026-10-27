import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";
import { SelectorArchivoImagen } from "./SelectorArchivoImagen";
import { SelectorMedioPrincipal } from "./SelectorMedioPrincipal";

interface PresentacionBorrador {
  nombre: string;
  guia: string;
  file: File | null;
}

interface NuevaRecetaModalProps {
  categorias: RecetarioCategoria[];
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: RecetarioCategoria) => void;
  onCategoriaEliminada: (id: number) => void;
}

/** Crea la receta primero (sin media) y, si se eligió imagen, sube el
 *  archivo justo después — no existe un id al que subirle una foto antes de
 *  que la receta misma exista (ver Global Constraints del plan). El cajero
 *  ve un solo botón y una sola acción. */
export function NuevaRecetaModal({
  categorias,
  onCerrar,
  onCreado,
  onCategoriaCreada,
  onCategoriaEliminada,
}: NuevaRecetaModalProps) {
  const [titulo, setTitulo] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [instrucciones, setInstrucciones] = useState("");
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">("imagen");
  const [videoUrl, setVideoUrl] = useState("");
  const [imagenPrincipalFile, setImagenPrincipalFile] = useState<File | null>(null);
  const [presentaciones, setPresentaciones] = useState<PresentacionBorrador[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [eliminandoCategoria, setEliminandoCategoria] = useState(false);
  const [confirmandoEliminarCategoria, setConfirmandoEliminarCategoria] = useState(false);

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

  function agregarPresentacion() {
    setPresentaciones((actual) => [...actual, { nombre: "", guia: "", file: null }]);
  }

  function actualizarPresentacion(indice: number, cambios: Partial<PresentacionBorrador>) {
    setPresentaciones((actual) => actual.map((p, i) => (i === indice ? { ...p, ...cambios } : p)));
  }

  function quitarPresentacion(indice: number) {
    setPresentaciones((actual) => actual.filter((_, i) => i !== indice));
  }

  async function crear() {
    if (!titulo.trim() || !instrucciones.trim()) return;
    setSubmitting(true);
    setError(null);

    let receta: Receta;
    try {
      receta = await recetarioApi.crear({
        titulo: titulo.trim(),
        instrucciones: instrucciones.trim(),
        categoriaId: categoriaId ? Number(categoriaId) : undefined,
        videoUrl: medioPrincipal === "video" && videoUrl.trim() ? videoUrl.trim() : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la receta");
      setSubmitting(false);
      return;
    }

    // La receta ya existe en este punto — si falla subir una imagen o crear
    // una presentación de acá en adelante, nunca debe parecer que la
    // creación entera falló (eso invitaría a reintentar con el mismo botón y
    // crear una receta duplicada). Se avisa aparte, se refresca la lista, y
    // se cierra — lo que falte se agrega desde "Editar".
    try {
      if (medioPrincipal === "imagen" && imagenPrincipalFile) {
        await recetarioApi.subirImagenPrincipal(receta.id, imagenPrincipalFile);
      }
      for (const p of presentaciones) {
        if (!p.nombre.trim()) continue;
        const emplatado = await recetarioApi.crearEmplatado(receta.id, {
          nombre: p.nombre.trim(),
          guia: p.guia.trim() || undefined,
        });
        if (p.file) await recetarioApi.subirImagenEmplatado(emplatado.id, p.file);
      }
    } catch (err) {
      await onCreado();
      alert(
        `La receta "${receta.titulo}" se creó, pero no se pudo terminar de guardar el emplatado (${
          err instanceof ApiError ? err.message : "error desconocido"
        }). Agrégalo desde "Editar".`,
      );
      setSubmitting(false);
      return;
    }

    await onCreado();
    setSubmitting(false);
  }

  return (
    <Modal titulo="Nueva receta" onCerrar={onCerrar} ancho="sm:w-[60vw]">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        className="mb-3 w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
      />

      <label className="mb-1 block text-xs font-medium">Categoría (opcional)</label>
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
          <SelectorArchivoImagen file={imagenPrincipalFile} onElegir={setImagenPrincipalFile} />
        )}
      </SelectorMedioPrincipal>

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Presentaciones de emplatado (opcional)
        </span>
        <p className="-mt-1 text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          La misma receta se puede servir de varias formas — cada una con su propio nombre, imagen y guía.
        </p>

        {presentaciones.map((p, indice) => (
          <div
            key={indice}
            className="flex flex-col gap-2 rounded-md border border-brand-vanilla-dark bg-brand-vanilla/40 p-3 dark:border-brand-green-700 dark:bg-brand-green-900/40"
          >
            <input
              value={p.nombre}
              onChange={(e) => actualizarPresentacion(indice, { nombre: e.target.value })}
              placeholder="Nombre de la presentación (ej. Con fresas)"
              className="w-full rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
            <SelectorArchivoImagen
              file={p.file}
              onElegir={(file) => actualizarPresentacion(indice, { file })}
              etiqueta="Elegir imagen de esta presentación"
            />
            <textarea
              value={p.guia}
              onChange={(e) => actualizarPresentacion(indice, { guia: e.target.value })}
              rows={2}
              placeholder="Guía de emplatado..."
              className="w-full resize-y rounded-md border border-brand-vanilla-dark bg-brand-vanilla px-2 py-2 text-sm text-brand-ink outline-none focus:border-brand-green-600 dark:border-brand-green-700 dark:bg-brand-green-900 dark:text-brand-vanilla"
            />
            <button
              type="button"
              onClick={() => quitarPresentacion(indice)}
              className="self-end text-xs font-medium text-red-600 hover:underline"
            >
              Eliminar esta presentación
            </button>
          </div>
        ))}

        <p className="text-xs text-brand-ink/50 dark:text-brand-vanilla/50">
          ### Título, **negrilla**, *cursiva* y líneas que empiecen con "- " para viñetas (en la guía).
        </p>
        <button
          type="button"
          onClick={agregarPresentacion}
          className="w-full rounded-md border-2 border-dashed border-brand-green-600 px-3 py-2 text-sm font-semibold text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
        >
          + Agregar otra presentación
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={crear}
        disabled={submitting || !titulo.trim() || !instrucciones.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Creando..." : "Crear receta"}
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
    </Modal>
  );
}
