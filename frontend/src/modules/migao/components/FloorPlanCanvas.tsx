import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../shared/components/Modal";
import type { OrdenResumen } from "../api";
import { formatDuracion } from "../format";
import type { MesaConOcupacion } from "../ocupacionMesas";

type ModoFloorPlan = "editor" | "seleccionar" | "ver";

interface FloorPlanCanvasProps {
  mesas: MesaConOcupacion[];
  modo: ModoFloorPlan;
  mesaSeleccionadaId?: number | null;
  /** "seleccionar": elegir una mesa (libre u ocupada — una mesa grande puede
   *  tener varios comensales con cuentas separadas, así que ocupada no
   *  bloquea agregar una más). "ver": abrir una de las cuentas abiertas de esa
   *  mesa (si hay más de una, primero se elige cuál). */
  onSeleccionar?: (mesa: MesaConOcupacion, orden?: OrdenResumen) => void;
  onMover?: (mesaId: number, posX: number, posY: number) => void | Promise<void>;
  onRedimensionar?: (mesaId: number, ancho: number, alto: number) => void | Promise<void>;
  onEditarDetalle?: (mesa: MesaConOcupacion) => void;
}

const MIN_TAMANO = 4;
const UMBRAL_CLICK_PX = 4;

function clamp(valor: number, min: number, max: number) {
  return Math.min(Math.max(valor, min), max);
}

/** Plano visual de mesas por área: mismo componente en 3 modos —
 *  "editor" (Root/Super Root arrastra/redimensiona/crea, sin librerías nuevas,
 *  solo Pointer Events sobre divs posicionados en % del lienzo), "seleccionar"
 *  (Mesero elige una mesa al crear/cambiar una orden) y "ver" (Caja Migao,
 *  solo lectura con badge de ocupación). La ocupación nunca se guarda: siempre
 *  viene ya calculada en `mesa.ordenes` (ver ocupacionMesas.ts). */
export function FloorPlanCanvas({
  mesas,
  modo,
  mesaSeleccionadaId,
  onSeleccionar,
  onMover,
  onRedimensionar,
  onEditarDetalle,
}: FloorPlanCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  // Estado local del arrastre/redimensión en curso, para que se sienta fluido
  // sin esperar la respuesta del PATCH — se confirma al soltar (pointerup).
  const [arrastre, setArrastre] = useState<{
    mesaId: number;
    tipo: "mover" | "redimensionar";
    posX: number;
    posY: number;
    ancho: number;
    alto: number;
  } | null>(null);
  const gestoRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPosX: number;
    startPosY: number;
    startAncho: number;
    startAlto: number;
    movimientoTotal: number;
  } | null>(null);
  // Mesa grande con varios comensales con cuenta abierta a la vez: al tocarla
  // (modo "ver") hay que elegir cuál cuenta abrir antes de continuar.
  const [mesaEligiendoCuenta, setMesaEligiendoCuenta] = useState<MesaConOcupacion | null>(null);

  // En modo "seleccionar", una vez elegida la mesa el plano se contrae a una
  // barra compacta (menos scroll para llegar a comensales/pedido) — toca la
  // barra para volver a abrirlo y cambiar de mesa. Se re-expande solo si la
  // selección se limpia desde afuera (ej. el mesero borra el número a mano).
  const [colapsado, setColapsado] = useState(false);
  useEffect(() => {
    if (mesaSeleccionadaId == null) setColapsado(false);
  }, [mesaSeleccionadaId]);

  const mesasDibujadas = mesas.filter((m) => m.pos_x != null && m.pos_y != null && m.ancho != null && m.alto != null);

  if (mesasDibujadas.length === 0 && modo !== "editor") {
    return null;
  }

  // En "seleccionar"/"ver" (Mesero/Caja) se recorta la vista al recuadro que
  // realmente ocupan las mesas dibujadas, en vez de mostrar siempre el lienzo
  // completo 0-100 — así en mobile no queda un montón de espacio vacío
  // alrededor de 2-3 mesas agrupadas en una esquina. El editor sí necesita el
  // lienzo completo (Root puede querer ubicar una mesa en cualquier parte).
  const recuadro =
    modo === "editor"
      ? null
      : (() => {
          const PADDING = 5;
          const xs = mesasDibujadas.map((m) => Number(m.pos_x));
          const ys = mesasDibujadas.map((m) => Number(m.pos_y));
          const xs2 = mesasDibujadas.map((m) => Number(m.pos_x) + Number(m.ancho));
          const ys2 = mesasDibujadas.map((m) => Number(m.pos_y) + Number(m.alto));
          const minX = clamp(Math.min(...xs) - PADDING, 0, 100);
          const minY = clamp(Math.min(...ys) - PADDING, 0, 100);
          const ancho = clamp(Math.max(...xs2) + PADDING, 0, 100) - minX || 100;
          const alto = clamp(Math.max(...ys2) + PADDING, 0, 100) - minY || 100;
          return { minX, minY, ancho, alto, relacion: clamp(ancho / alto, 0.5, 2.5) };
        })();

  const mesaSeleccionada = mesas.find((m) => m.id === mesaSeleccionadaId);
  if (modo === "seleccionar" && colapsado && mesaSeleccionada) {
    return (
      <button
        type="button"
        onClick={() => setColapsado(false)}
        className="flex w-full items-center justify-between rounded-lg border-2 border-brand-green-600 bg-brand-green-50 px-4 py-3 text-left dark:bg-brand-green-700/20"
      >
        <span className="flex items-center gap-2 font-semibold text-brand-green-700 dark:text-brand-vanilla">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-green-700 text-[11px] font-bold text-white dark:bg-brand-vanilla dark:text-brand-green-900">
            ✓
          </span>
          Mesa {mesaSeleccionada.numero} seleccionada
        </span>
        <span className="text-sm text-brand-green-700 underline dark:text-brand-vanilla">Cambiar</span>
      </button>
    );
  }

  // Postgres NUMERIC vuelve como texto (ver Mesa en api.ts) — hay que parsear
  // antes de hacer cualquier cuenta, si no "15.00" + 5 concatena en vez de sumar.
  function valorDeMesa(mesa: MesaConOcupacion) {
    if (arrastre?.mesaId === mesa.id) return arrastre;
    return { posX: Number(mesa.pos_x), posY: Number(mesa.pos_y), ancho: Number(mesa.ancho), alto: Number(mesa.alto) };
  }

  function iniciarGesto(e: React.PointerEvent, mesa: MesaConOcupacion, tipo: "mover" | "redimensionar") {
    if (modo !== "editor") return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const posX = Number(mesa.pos_x);
    const posY = Number(mesa.pos_y);
    const ancho = Number(mesa.ancho);
    const alto = Number(mesa.alto);
    gestoRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPosX: posX,
      startPosY: posY,
      startAncho: ancho,
      startAlto: alto,
      movimientoTotal: 0,
    };
    setArrastre({ mesaId: mesa.id, tipo, posX, posY, ancho, alto });
  }

  function moverGesto(e: React.PointerEvent, mesa: MesaConOcupacion) {
    const gesto = gestoRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!gesto || !rect || arrastre?.mesaId !== mesa.id) return;

    const deltaXPct = ((e.clientX - gesto.startClientX) / rect.width) * 100;
    const deltaYPct = ((e.clientY - gesto.startClientY) / rect.height) * 100;
    gesto.movimientoTotal = Math.max(
      gesto.movimientoTotal,
      Math.abs(e.clientX - gesto.startClientX),
      Math.abs(e.clientY - gesto.startClientY),
    );

    if (arrastre.tipo === "mover") {
      const posX = clamp(gesto.startPosX + deltaXPct, 0, 100 - gesto.startAncho);
      const posY = clamp(gesto.startPosY + deltaYPct, 0, 100 - gesto.startAlto);
      setArrastre({ ...arrastre, posX, posY });
    } else {
      const ancho = clamp(gesto.startAncho + deltaXPct, MIN_TAMANO, 100 - gesto.startPosX);
      const alto = clamp(gesto.startAlto + deltaYPct, MIN_TAMANO, 100 - gesto.startPosY);
      setArrastre({ ...arrastre, ancho, alto });
    }
  }

  async function soltarGesto(mesa: MesaConOcupacion) {
    const gesto = gestoRef.current;
    const actual = arrastre;
    gestoRef.current = null;
    if (!gesto || !actual || actual.mesaId !== mesa.id) {
      setArrastre(null);
      return;
    }

    if (gesto.movimientoTotal < UMBRAL_CLICK_PX) {
      setArrastre(null);
      onEditarDetalle?.(mesa);
      return;
    }

    // No se limpia el arrastre optimista hasta que el PATCH + refetch del
    // padre terminen: si se limpiara antes, por un instante se vuelve a
    // pintar con la posición vieja (la que trae `mesas` todavía) y luego
    // "salta" a la nueva en cuanto llega la respuesta — el efecto de
    // "se devuelve y de un salto se acomoda" que se veía antes.
    try {
      if (actual.tipo === "mover") await onMover?.(mesa.id, actual.posX, actual.posY);
      else await onRedimensionar?.(mesa.id, actual.ancho, actual.alto);
    } finally {
      setArrastre(null);
    }
  }

  function clickMesa(mesa: MesaConOcupacion) {
    if (modo === "seleccionar") {
      // Ocupada no bloquea: una mesa de varias sillas puede tener más de un
      // comensal, cada uno con su propia cuenta — siempre se puede agregar otra.
      onSeleccionar?.(mesa);
      setColapsado(true);
    } else if (modo === "ver") {
      if (mesa.ordenes.length === 1) onSeleccionar?.(mesa, mesa.ordenes[0]);
      else if (mesa.ordenes.length > 1) setMesaEligiendoCuenta(mesa);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={canvasRef}
        className={`relative overflow-hidden rounded-lg border border-brand-vanilla-dark bg-brand-green-50 dark:border-brand-green-700 dark:bg-brand-green-900/60 ${
          recuadro ? "mx-auto w-full max-w-md" : "w-full aspect-[4/3]"
        }`}
        style={recuadro ? { aspectRatio: `${recuadro.relacion} / 1` } : undefined}
      >
        {mesasDibujadas.map((mesa) => {
          const base = valorDeMesa(mesa);
          // Coordenadas siempre en % del lienzo absoluto (0-100); si hay
          // recuadro (modo "seleccionar"/"ver"), se reexpresan en % de esa
          // porción recortada para que la vista se ajuste solo al espacio que
          // ocupan las mesas.
          const { posX, posY, ancho, alto } = recuadro
            ? {
                posX: ((base.posX - recuadro.minX) / recuadro.ancho) * 100,
                posY: ((base.posY - recuadro.minY) / recuadro.alto) * 100,
                ancho: (base.ancho / recuadro.ancho) * 100,
                alto: (base.alto / recuadro.alto) * 100,
              }
            : base;
          const ocupada = mesa.ordenes.length > 0;
          const seleccionada = mesaSeleccionadaId === mesa.id;
          const seleccionable = modo === "editor" || modo === "seleccionar" || (modo === "ver" && ocupada);
          return (
            <div
              key={mesa.id}
              onPointerDown={(e) => iniciarGesto(e, mesa, "mover")}
              onPointerMove={(e) => moverGesto(e, mesa)}
              onPointerUp={() => soltarGesto(mesa)}
              onClick={() => clickMesa(mesa)}
              style={{
                left: `${posX}%`,
                top: `${posY}%`,
                width: `${ancho}%`,
                height: `${alto}%`,
                touchAction: modo === "editor" ? "none" : undefined,
              }}
              className={`absolute flex flex-col items-center justify-center overflow-hidden rounded-md border-2 px-1 text-center text-xs font-semibold transition-all ${
                seleccionable ? "cursor-pointer" : "cursor-default opacity-60"
              } ${
                seleccionada
                  ? "z-10 scale-105 border-brand-green-700 bg-brand-green-600 text-white shadow-lg ring-4 ring-brand-green-400 ring-offset-2 ring-offset-brand-vanilla dark:ring-offset-brand-green-900"
                  : ocupada
                    ? "border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-brand-green-700 bg-brand-vanilla text-brand-ink dark:border-brand-vanilla dark:bg-brand-green-700 dark:text-brand-vanilla"
              }`}
            >
              {seleccionada && (
                <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-green-700 text-[11px] font-bold text-white shadow dark:bg-brand-vanilla dark:text-brand-green-900">
                  ✓
                </span>
              )}
              <span className="w-full break-words leading-tight">Mesa {mesa.numero}</span>
              {modo === "ver" && ocupada && (
                <span className="text-[10px] font-normal">
                  {mesa.ordenes.length === 1
                    ? `⏱ ${formatDuracion(mesa.ordenes[0].created_at)} · 👥 ${mesa.ordenes[0].numero_personas ?? mesa.capacidad}`
                    : `🧾 ${mesa.ordenes.length} cuentas`}
                </span>
              )}
              {modo === "seleccionar" && ocupada && !seleccionada && (
                <span className="text-[10px] font-normal">
                  {mesa.ordenes.length === 1 ? "1 cuenta abierta" : `${mesa.ordenes.length} cuentas abiertas`}
                </span>
              )}
              {modo === "editor" && (
                <div
                  onPointerDown={(e) => iniciarGesto(e, mesa, "redimensionar")}
                  onPointerMove={(e) => moverGesto(e, mesa)}
                  onPointerUp={() => soltarGesto(mesa)}
                  style={{ touchAction: "none" }}
                  className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize rounded-tl bg-brand-green-700 dark:bg-brand-vanilla"
                />
              )}
            </div>
          );
        })}

        {mesasDibujadas.length === 0 && modo === "editor" && (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-brand-ink/60 dark:text-brand-vanilla/60">
            Aún no hay mesas dibujadas para esta área.
          </p>
        )}
      </div>

      {mesaEligiendoCuenta && (
        <Modal titulo={`Mesa ${mesaEligiendoCuenta.numero} — elige la cuenta`} onCerrar={() => setMesaEligiendoCuenta(null)}>
          <div className="flex flex-col gap-2">
            {mesaEligiendoCuenta.ordenes.map((orden) => (
              <button
                key={orden.id}
                onClick={() => {
                  onSeleccionar?.(mesaEligiendoCuenta, orden);
                  setMesaEligiendoCuenta(null);
                }}
                className="flex items-center justify-between rounded-lg border border-brand-vanilla-dark px-3 py-2 text-left text-sm hover:border-brand-green-400 hover:bg-brand-green-50 dark:border-brand-green-700 dark:hover:bg-brand-green-700/30"
              >
                <span className="font-medium text-brand-ink dark:text-brand-vanilla">Comensal {orden.comensal_numero}</span>
                <span className="text-brand-ink/60 dark:text-brand-vanilla/60">
                  ⏱ {formatDuracion(orden.created_at)} · 👥 {orden.numero_personas ?? "—"}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
