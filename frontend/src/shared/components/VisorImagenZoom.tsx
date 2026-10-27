import { useRef, useState, type ReactNode } from "react";

interface VisorImagenZoomProps {
  src: string;
  alt: string;
  onCerrar: () => void;
  // Contenido extra (ej. nombre + guía de una presentación de emplatado) que
  // se muestra como una franja arriba, sin estorbar el pie con la pista de
  // "pellizca para acercar".
  encabezado?: ReactNode;
}

// 1 = ajustada a pantalla. ESCALA_TAP: a dónde salta un toque/clic simple.
// ESCALA_MAX: tope del pellizco — más allá no tiene sentido acercar más.
const ESCALA_MIN = 1;
const ESCALA_TAP = 1.4;
const ESCALA_MAX = 3;

function distancia(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
function centroToques(a: React.Touch, b: React.Touch) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}
function clamp(valor: number, min: number, max: number) {
  return Math.min(max, Math.max(min, valor));
}

interface EstadoGesto {
  tipo: "pellizco" | "arrastre";
  distanciaInicial: number;
  escalaInicial: number;
  offsetInicial: { x: number; y: number };
  puntoInicial: { x: number; y: number };
  // true en cuanto el dedo/los dedos se movieron de verdad — así el "tap"
  // (clic) que dispara el navegador al soltar un pellizco/arrastre no se
  // confunde con un toque simple y no alterna el zoom por accidente.
  seMovio: boolean;
}

/**
 * Overlay de pantalla completa con una imagen que se acerca con los dedos
 * (pellizcar), con la rueda/trackpad en desktop, o con un toque simple como
 * atajo rápido — y se puede arrastrar con un dedo (o el mouse) una vez
 * acercada. Pensado para tablets/celulares. Es el visor que usa
 * ImagenConZoom (tocando una miniatura) y también Cocina (abriéndolo
 * directo desde un botón, sin miniatura de por medio).
 */
export function VisorImagenZoom({ src, alt, onCerrar, encabezado }: VisorImagenZoomProps) {
  const [escala, setEscala] = useState(ESCALA_MIN);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const gestoRef = useRef<EstadoGesto | null>(null);
  const [enGesto, setEnGesto] = useState(false);

  function manejarTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      gestoRef.current = {
        tipo: "pellizco",
        distanciaInicial: distancia(e.touches[0], e.touches[1]),
        escalaInicial: escala,
        offsetInicial: offset,
        puntoInicial: centroToques(e.touches[0], e.touches[1]),
        seMovio: false,
      };
      setEnGesto(true);
    } else if (e.touches.length === 1 && escala > ESCALA_MIN) {
      gestoRef.current = {
        tipo: "arrastre",
        distanciaInicial: 0,
        escalaInicial: escala,
        offsetInicial: offset,
        puntoInicial: { x: e.touches[0].clientX, y: e.touches[0].clientY },
        seMovio: false,
      };
      setEnGesto(true);
    }
  }

  function manejarTouchMove(e: React.TouchEvent) {
    const gesto = gestoRef.current;
    if (!gesto) return;
    // No hace falta preventDefault: touchAction "none" en la imagen ya le
    // dice al navegador que no haga scroll/zoom nativo ahí (y React adjunta
    // los listeners de touch como pasivos, así que preventDefault ni
    // funcionaría).
    if (gesto.tipo === "pellizco" && e.touches.length === 2) {
      const nuevaDistancia = distancia(e.touches[0], e.touches[1]);
      const factor = nuevaDistancia / gesto.distanciaInicial;
      setEscala(clamp(gesto.escalaInicial * factor, ESCALA_MIN, ESCALA_MAX));
      gesto.seMovio = true;
    } else if (gesto.tipo === "arrastre" && e.touches.length === 1) {
      const dx = e.touches[0].clientX - gesto.puntoInicial.x;
      const dy = e.touches[0].clientY - gesto.puntoInicial.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) gesto.seMovio = true;
      setOffset({ x: gesto.offsetInicial.x + dx, y: gesto.offsetInicial.y + dy });
    }
  }

  function manejarTouchEnd(e: React.TouchEvent) {
    if (e.touches.length > 0) return; // todavía queda algún dedo apoyado
    // Pellizco que terminó casi en 1x: redondea a "ajustada" de una vez (sin
    // dejarlo en un 1.02x raro) y recentra — a esa escala no debe quedar
    // panorámica, para no dejar la imagen descuadrada sin cómo arreglarlo.
    setEscala((actual) => {
      if (actual < ESCALA_MIN + 0.05) {
        setOffset({ x: 0, y: 0 });
        return ESCALA_MIN;
      }
      return actual;
    });
    gestoRef.current = null;
    setEnGesto(false);
  }

  /** Atajo de un toque/clic simple: si no hubo pellizco/arrastre real justo
   *  antes (eso ya lo resuelve el zoom), salta a un acercado cómodo, o
   *  vuelve a ajustar si ya estaba acercada. */
  function manejarClicImagen() {
    setEscala((actual) => (actual > ESCALA_MIN ? ESCALA_MIN : ESCALA_TAP));
    setOffset({ x: 0, y: 0 });
  }

  function manejarWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.01;
    setEscala((actual) => clamp(actual + delta, ESCALA_MIN, ESCALA_MAX));
  }

  const acercada = escala > ESCALA_MIN;

  return (
    <div onClick={onCerrar} className="fixed inset-0 z-80 flex flex-col items-center justify-center overflow-hidden bg-black/80">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCerrar();
        }}
        aria-label="Cerrar"
        className="fixed right-4 top-4 z-81 flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-brand-ink shadow-lg hover:bg-brand-vanilla"
      >
        ✕
      </button>

      {encabezado && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed left-4 right-16 top-4 z-81 rounded-lg bg-black/60 px-3 py-2 text-sm text-white"
        >
          {encabezado}
        </div>
      )}

      <img
        src={src}
        alt={alt}
        onClick={(e) => {
          e.stopPropagation();
          if (!gestoRef.current?.seMovio) manejarClicImagen();
        }}
        onTouchStart={manejarTouchStart}
        onTouchMove={manejarTouchMove}
        onTouchEnd={manejarTouchEnd}
        onWheel={manejarWheel}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${escala})`,
          transition: enGesto ? "none" : "transform 150ms ease-out",
          touchAction: "none",
        }}
        className={`max-h-[85vh] max-w-[90vw] select-none rounded-lg object-contain shadow-2xl ${
          acercada ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
      />

      <p className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-xs text-white">
        Pellizca con los dedos para acercar · toca para {acercada ? "alejar" : "acercar"}
      </p>
    </div>
  );
}
