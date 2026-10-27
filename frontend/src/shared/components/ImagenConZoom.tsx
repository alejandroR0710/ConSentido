import { useState } from "react";
import { VisorImagenZoom } from "./VisorImagenZoom";

interface ImagenConZoomProps {
  src: string;
  alt: string;
  className?: string;
}

/** Miniatura que se puede ampliar a pantalla completa con un clic/toque —
 *  ver VisorImagenZoom para el zoom con gestos dentro del overlay. */
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
      {ampliada && <VisorImagenZoom src={src} alt={alt} onCerrar={() => setAmpliada(false)} />}
    </>
  );
}
