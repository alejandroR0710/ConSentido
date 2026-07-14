import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { desbloquearAudio } from "../../modules/migao/beep";
import { useAuth } from "../auth/useAuth";
import { Modal } from "../components/Modal";
import { RoleNav } from "./RoleNav";

/**
 * Layout responsive único para todos los roles: en desktop prioriza un sidebar
 * con navegación completa; en mobile la navegación vive detrás de un botón
 * hamburguesa (menú deslizable) — un rol como Super Root ve más de 10 pantallas,
 * y una barra horizontal fija no alcanza a mostrarlas todas ni se puede hacer
 * scroll para ver el resto.
 */
export function AppShell() {
  const { usuario, logout } = useAuth();
  const [menuAbierto, setMenuAbierto] = useState(false);

  useEffect(() => {
    // Reactiva el audio en cada toque (no solo el primero): en móvil el
    // AudioContext se vuelve a suspender solo al bloquear pantalla o volver de
    // segundo plano, así que hay que darle oportunidad de reactivarse en cada
    // toque de la sesión, no nada más al arrancar (ver beep.ts).
    window.addEventListener("pointerdown", desbloquearAudio);
    return () => window.removeEventListener("pointerdown", desbloquearAudio);
  }, []);

  if (!usuario) return null;

  return (
    <div className="min-h-screen bg-brand-vanilla text-brand-ink dark:bg-brand-green-900 dark:text-brand-vanilla">
      <header className="flex items-center justify-between border-b border-brand-vanilla-dark px-4 py-3 dark:border-brand-green-700">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            className="-ml-1 rounded-md p-1.5 text-xl text-brand-green-700 hover:bg-brand-green-50 md:hidden dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
          >
            ☰
          </button>
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-brand-green-700 dark:text-brand-vanilla sm:text-lg">
            Con Sentido / El Rinconcito del Migao
          </span>
        </div>
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
          <RoleNav modulosPermitidos={usuario.modulos} rol={usuario.rol} />
        </aside>

        <main className="min-h-[calc(100svh-57px)] flex-1 p-4">
          <Outlet />
        </main>
      </div>

      {menuAbierto && (
        <Modal titulo="Menú" onCerrar={() => setMenuAbierto(false)}>
          <RoleNav
            modulosPermitidos={usuario.modulos}
            rol={usuario.rol}
            onNavigate={() => setMenuAbierto(false)}
          />
        </Modal>
      )}
    </div>
  );
}
