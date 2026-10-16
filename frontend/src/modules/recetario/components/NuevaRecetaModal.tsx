import { useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { Modal } from "../../../shared/components/Modal";
import { recetarioApi, type Receta, type RecetarioCategoria } from "../api";

interface NuevaRecetaModalProps {
  categorias: RecetarioCategoria[];
  onCerrar: () => void;
  onCreado: () => Promise<void> | void;
  onCategoriaCreada: (categoria: RecetarioCategoria) => void;
}

const OPCIONES_MEDIO = [
  { valor: "imagen" as const, etiqueta: "Imagen" },
  { valor: "video" as const, etiqueta: "Video" },
];

/** Crea la receta primero (sin media) y, si se eligió imagen, sube el
 *  archivo justo después — no existe un id al que subirle una foto antes de
 *  que la receta misma exista (ver Global Constraints del plan). El cajero
 *  ve un solo botón y una sola acción. */
export function NuevaRecetaModal({ categorias, onCerrar, onCreado, onCategoriaCreada }: NuevaRecetaModalProps) {
  const [titulo, setTitulo] = useState("");
  const [categoriaId, setCategoriaId] = useState<number | "">("");
  const [instrucciones, setInstrucciones] = useState("");
  const [medioPrincipal, setMedioPrincipal] = useState<"imagen" | "video">("imagen");
  const [videoUrl, setVideoUrl] = useState("");
  const [imagenPrincipalFile, setImagenPrincipalFile] = useState<File | null>(null);
  const [imagenEmplatadoFile, setImagenEmplatadoFile] = useState<File | null>(null);
  const [descripcionEmplatado, setDescripcionEmplatado] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
        descripcionEmplatado: descripcionEmplatado.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la receta");
      setSubmitting(false);
      return;
    }

    // La receta ya existe en este punto — si falla subir una imagen de acá en
    // adelante, nunca debe parecer que la creación entera falló (eso
    // invitaría a reintentar con el mismo botón y crear una receta
    // duplicada). Se avisa aparte, se refresca la lista, y se cierra — para
    // agregar la imagen que faltó hay que entrar a "Editar".
    try {
      if (medioPrincipal === "imagen" && imagenPrincipalFile) {
        await recetarioApi.subirImagenPrincipal(receta.id, imagenPrincipalFile);
      }
      if (imagenEmplatadoFile) {
        await recetarioApi.subirImagenEmplatado(receta.id, imagenEmplatadoFile);
      }
    } catch (err) {
      await onCreado();
      alert(
        `La receta "${receta.titulo}" se creó, pero no se pudo subir una de las imágenes (${
          err instanceof ApiError ? err.message : "error desconocido"
        }). Agrégala desde "Editar".`,
      );
      setSubmitting(false);
      return;
    }

    await onCreado();
    setSubmitting(false);
  }

  return (
    <Modal titulo="Nueva receta" onCerrar={onCerrar} maxWidth="sm:max-w-xl">
      <label className="mb-1 block text-xs font-medium">Título</label>
      <input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
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
        <div className="mb-4">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImagenPrincipalFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-brand-ink dark:text-brand-vanilla"
          />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-vanilla-dark p-3 dark:border-brand-green-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink/70 dark:text-brand-vanilla/70">
          Ejemplo de emplatado (opcional)
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImagenEmplatadoFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-brand-ink dark:text-brand-vanilla"
        />
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
        onClick={crear}
        disabled={submitting || !titulo.trim() || !instrucciones.trim()}
        className="w-full rounded-md bg-brand-green-700 px-4 py-3 font-semibold text-brand-vanilla hover:bg-brand-green-600 disabled:opacity-60"
      >
        {submitting ? "Creando..." : "Crear receta"}
      </button>
    </Modal>
  );
}
