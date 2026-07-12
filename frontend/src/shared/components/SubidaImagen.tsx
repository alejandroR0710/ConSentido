import { useState, type ChangeEvent } from "react";
import { ApiError, resolveImageUrl } from "../api/client";

interface SubidaImagenProps {
  imagenUrl: string | null;
  onSubir: (file: File) => Promise<void>;
}

/** Miniatura + botón para subir/reemplazar la foto de un insumo o producto. */
export function SubidaImagen({ imagenUrl, onSubir }: SubidaImagenProps) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manejarArchivo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      await onSubir(file);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen");
    } finally {
      setSubiendo(false);
      e.target.value = "";
    }
  }

  const url = resolveImageUrl(imagenUrl);

  return (
    <div className="mb-4">
      <label className="mb-1 block text-xs font-medium">Foto</label>
      <div className="flex items-center gap-3">
        {url ? (
          <img
            src={url}
            alt=""
            className="h-16 w-16 rounded-md border border-brand-vanilla-dark object-cover dark:border-brand-green-700"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-brand-vanilla-dark text-center text-[10px] text-brand-ink/40 dark:border-brand-green-700 dark:text-brand-vanilla/40">
            Sin foto
          </div>
        )}
        <label className="cursor-pointer rounded-md border border-brand-green-700 px-3 py-1.5 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40">
          {subiendo ? "Subiendo..." : "Cambiar foto"}
          <input type="file" accept="image/*" className="hidden" onChange={manejarArchivo} disabled={subiendo} />
        </label>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
