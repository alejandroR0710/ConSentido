import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { desbloquearAudio } from "../../modules/migao/beep";
import { useAuth } from "../auth/useAuth";
import { RoleNav } from "./RoleNav";

/**
 * Layout responsive único para todos los roles: en desktop prioriza un sidebar
 * con navegación completa; en mobile prioriza el contenido y mueve la navegación
 * a una barra inferior de acceso rápido con el pulgar (patrón común en apps POS).
 */
export function AppShell() {
  const { usuario, logout } = useAuth();

  useEffect(() => {
    // Desbloquea el audio con el primer toque/clic real del usuario en la sesión
    // (necesario en móvil, ver beep.ts) y se quita solo después de lograrlo.
    function alPrimerToque() {
      desbloquearAudio();
      window.removeEventListener("pointerdown", alPrimerToque);
    }
    window.addEventListener("pointerdown", alPrimerToque);
    return () => window.removeEventListener("pointerdown", alPrimerToque);
  }, []);

  if (!usuario) return null;

  return (
    <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
      <header className="flex items-center justify-between border-b border-brand-vanilla-dark px-4 py-3 dark:border-brand-green-700">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-brand-green-700 dark:text-brand-vanilla sm:text-lg">
          Con Sentido / El Rinconcito del Migao
        </span>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <span className="hidden sm:inline">{usuario.nombre}</span>
          <button
            onClick={() => logout()}
            className="rounded-md border border-brand-green-700 px-3 py-1 text-brand-green-700 hover:bg-brand-green-50 dark:border-brand-vanilla dark:text-brand-vanilla dark:hover:bg-brand-green-700"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        <aside className="sticky top-0 hidden h-[calc(100svh-57px)] w-56 shrink-0 border-r border-brand-vanilla-dark p-3 md:block dark:border-brand-green-700">
          <RoleNav modulosPermitidos={usuario.modulos} rol={usuario.rol} orientation="vertical" />
        </aside>

        <main className="min-h-[calc(100svh-57px)] flex-1 p-4 pb-20 md:pb-4">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-brand-vanilla-dark bg-brand-vanilla p-2 md:hidden dark:border-brand-green-700 dark:bg-brand-green-900">
        <RoleNav modulosPermitidos={usuario.modulos} rol={usuario.rol} orientation="horizontal" />
      </nav>
    </div>
  );
}
