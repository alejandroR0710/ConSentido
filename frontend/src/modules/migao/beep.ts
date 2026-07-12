let contextoCompartido: AudioContext | null = null;

function obtenerContexto(): AudioContext | null {
  try {
    if (!contextoCompartido) {
      const AudioContextClass =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      contextoCompartido = new AudioContextClass();
    }
    return contextoCompartido;
  } catch {
    return null;
  }
}

/**
 * Los navegadores móviles (Safari/iOS sobre todo, y Chrome Android en buena
 * medida) mantienen el AudioContext en "suspended" hasta que el usuario toca
 * la pantalla, y solo se puede reanudar (`resume()`) dentro de un gesto real
 * del usuario — nunca desde un `setInterval`. Como las notificaciones de
 * Mesero/Cocina se disparan desde el polling (no de un clic), sin esto suenan
 * en desktop pero quedan mudas en el celular. Se llama una sola vez, en el
 * primer toque/clic de toda la sesión (ver AppShell.tsx).
 */
export function desbloquearAudio() {
  const ctx = obtenerContexto();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {
      /* si falla, se reintenta solo en el próximo toque del usuario */
    });
  }
}

/** Beep corto generado con Web Audio API: no requiere ningún archivo de sonido. */
export function reproducirBeep() {
  const ctx = obtenerContexto();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    /* se omite el sonido, no es crítico */
  }
}

/** Notificación minimalista: un "tick" suave y muy corto, para avisos frecuentes
 *  (ej. pedido nuevo en Cocina, orden lista en Mesero) que no deben sonar como
 *  una alarma. */
export function reproducirNotificacionSuave() {
  const ctx = obtenerContexto();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 1200;
    // Ataque casi instantáneo y decaimiento exponencial rápido: se escucha como
    // un "tick" suave en vez de un beep sostenido.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
  } catch {
    /* se omite el sonido, no es crítico */
  }
}

/** Alerta más urgente que el beep normal (3 tonos cortos y graves seguidos) para
 *  pedidos que llevan demasiado tiempo esperando en Cocina. */
export function reproducirAlerta() {
  const ctx = obtenerContexto();
  if (!ctx) return;
  try {
    const inicioTonos = [0, 0.35, 0.7];
    inicioTonos.forEach((offset) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + offset);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + offset);
      oscillator.stop(ctx.currentTime + offset + 0.25);
    });
  } catch {
    /* se omite el sonido, no es crítico */
  }
}
