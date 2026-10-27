import { useEffect, useState } from "react";
import { ImagenConZoom } from "../../../shared/components/ImagenConZoom";

interface SelectorArchivoImagenProps {
  file: File | null;
  onElegir: (file: File | null) => void;
  etiqueta?: string;
}

/** Selector de archivo de imagen con el mismo lenguaje visual que el resto
 *  de la app (miniatura + botón, como SubidaImagen) en vez del selector
 *  nativo del navegador — se usa para elegir una imagen ANTES de que la
 *  receta exista (ver NuevaRecetaModal), cuando todavía no hay a quién
 *  subírsela de una. Muestra una vista previa real del archivo elegido (no
 *  solo el nombre) para saber cuál imagen quedó cargada, y se puede tocar
 *  para verla en grande, justo donde se elige/reemplaza. */
export function SelectorArchivoImagen({ file, onElegir, etiqueta = "Elegir imagen" }: SelectorArchivoImagenProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="flex items-center gap-3">
      {previewUrl ? (
        <ImagenConZoom
          src={previewUrl}
          alt={file?.name ?? ""}
          className="h-16 w-16 rounded-md border border-brand-vanilla-dark object-cover dark:border-brand-green-700"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-brand-vanilla-dark text-center text-2xl dark:border-brand-green-700">
          📷
        </div>
      )}
      <label className="cursor-pointer rounded-md border border-brand-green-700 px-3 py-1.5 text-xs font-medium text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700/40">
        {file ? "Cambiar imagen" : etiqueta}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onElegir(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  );
}
