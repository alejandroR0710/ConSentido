import { useState } from "react";
import { activarNotificaciones, notificacionesActivas, notificacionesSoportadas } from "./push";

/** Banner "Activar notificaciones" — mismo patrón visual que el de activar
 *  sonido en Cocina: un botón explícito, porque pedir el permiso del
 *  navegador solo funciona desde un gesto real del usuario, nunca solo. */
export function BannerNotificaciones() {
  const [activas, setActivas] = useState(() => notificacionesActivas());
  const [error, setError] = useState<string | null>(null);

  if (!notificacionesSoportadas() || activas) return null;

  async function activar() {
    setError(null);
    const ok = await activarNotificaciones();
    if (ok) {
      setActivas(true);
    } else {
      setError("No se pudo activar — revisa el permiso de notificaciones del navegador.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={activar}
        className="w-full rounded-lg border-2 border-dashed border-brand-green-600 bg-brand-green-50 px-4 py-3 text-left font-medium text-brand-green-700 hover:bg-brand-green-100 dark:border-brand-green-500 dark:bg-brand-green-950/20 dark:text-brand-vanilla"
      >
        🔔 Toca aquí para activar notificaciones (avisa aunque cierres la app)
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
