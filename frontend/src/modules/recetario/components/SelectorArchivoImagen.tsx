interface SelectorArchivoImagenProps {
  file: File | null;
  onElegir: (file: File | null) => void;
  etiqueta?: string;
}

/** Selector de archivo de imagen con el mismo lenguaje visual que el resto
 *  de la app (zona de borde punteado + ícono) en vez del selector nativo del
 *  navegador — se usa para elegir una imagen ANTES de que la receta exista
 *  (ver NuevaRecetaModal), cuando todavía no hay a quién subírsela de una. */
export function SelectorArchivoImagen({ file, onElegir, etiqueta = "Elegir imagen" }: SelectorArchivoImagenProps) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand-vanilla-dark p-4 text-center hover:border-brand-green-500 dark:border-brand-green-700 dark:hover:border-brand-green-500">
      <span className="text-2xl" aria-hidden>
        📷
      </span>
      <span className="text-sm font-medium text-brand-green-700 dark:text-brand-vanilla">
        {file ? file.name : etiqueta}
      </span>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onElegir(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
