import { useState } from "react";

interface ImagenConZoomProps {
  src: string;
  alt: string;
  className?: string;
}

/** Imagen que se puede ampliar a pantalla completa con un clic — el resto de
 *  la pantalla (texto, botones) nunca hace zoom, solo la imagen misma. Mismo
 *  patrón de lightbox ya usado en SugerenciasProducto.tsx (fotos de
 *  productos), acá extraído para reusarlo en el recetario. */
export function ImagenConZoom({ src, alt, className }: ImagenConZoomProps) {
  const [ampliada, setAmpliada] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt}
        onClick={() => setAmpliada(true)}
        title="Ver en grande"
        className={`cursor-zoom-in ${className ?? ""}`}
      />
      {ampliada && (
        <div
          onClick={() => setAmpliada(false)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={alt} className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
            <button
              type="button"
              onClick={() => setAmpliada(false)}
              aria-label="Cerrar"
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg text-brand-ink shadow-lg hover:bg-brand-vanilla"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
