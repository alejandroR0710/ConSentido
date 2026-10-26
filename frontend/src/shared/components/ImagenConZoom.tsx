import { useState } from "react";

interface ImagenConZoomProps {
  src: string;
  alt: string;
  className?: string;
}

/** Imagen que se puede ampliar a pantalla completa con un clic. Adentro, un
 *  segundo toque sobre la imagen la acerca todavía más (más ancha que la
 *  pantalla, con scroll para recorrerla) y otro toque la vuelve a ajustar a
 *  la pantalla. El resto de la página nunca hace zoom, solo la imagen misma.
 *  Mismo patrón de lightbox ya usado en SugerenciasProducto.tsx (fotos de
 *  productos), acá extraído y con el acercado extra, para reusarlo en el
 *  recetario. */
export function ImagenConZoom({ src, alt, className }: ImagenConZoomProps) {
  const [ampliada, setAmpliada] = useState(false);
  const [acercada, setAcercada] = useState(false);

  function cerrar() {
    setAmpliada(false);
    setAcercada(false);
  }

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
          onClick={cerrar}
          className={`fixed inset-0 z-80 bg-black/80 ${
            acercada ? "overflow-auto" : "flex items-center justify-center p-6"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cerrar();
            }}
            aria-label="Cerrar"
            className="fixed right-4 top-4 z-81 flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-brand-ink shadow-lg hover:bg-brand-vanilla"
          >
            ✕
          </button>

          <div onClick={(e) => e.stopPropagation()} className={acercada ? "w-full p-6" : ""}>
            <img
              src={src}
              alt={alt}
              onClick={() => setAcercada((a) => !a)}
              title={acercada ? "Tocar para alejar" : "Tocar para acercar"}
              className={
                acercada
                  ? "w-[180vw] max-w-none cursor-zoom-out rounded-lg shadow-2xl"
                  : "max-h-[85vh] max-w-[90vw] cursor-zoom-in rounded-lg object-contain shadow-2xl"
              }
            />
          </div>

          <p className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {acercada ? "Toca la imagen para alejar" : "Toca la imagen para acercar más"}
          </p>
        </div>
      )}
    </>
  );
}
