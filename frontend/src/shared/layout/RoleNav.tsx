import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MODULES_META, NAV_GROUPS, ROLES_CON_DASHBOARD } from "./modules-meta";

interface RoleNavProps {
  modulosPermitidos: string[];
  rol: string;
  onNavigate?: () => void;
}

const CLASE_LINK_ACTIVO = "bg-brand-green-700 text-brand-vanilla";
const CLASE_LINK_INACTIVO =
  "text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40";

/**
 * Renderiza solo las pantallas que el rol activo puede realmente usar.
 * El Dashboard ("/") es la excepción: no es "un módulo más", es una vista transversal
 * que solo tiene sentido para roles con visión de todo el negocio (ROLES_CON_DASHBOARD).
 * Se distingue por su path, no por su slug — Caja también vive bajo el slug "general"
 * (así se modeló el permiso) pero sí debe verla el Cajero, no solo Super Root.
 * Además, cuando una entrada declara `roles` (Mesero/Migao/Cocina comparten el
 * slug "migao" pero son pantallas de sub-roles distintos), solo esos roles la ven
 * — el acceso a nivel de módulo no alcanza para saber qué pantalla es de cada quién.
 * El mismo listado alimenta el sidebar de escritorio y el menú hamburguesa de mobile,
 * así que agregar un módulo nuevo no requiere tocar el layout responsive.
 *
 * Migao/Con Sentido/Insumos se muestran como acordeón (NAV_GROUPS, en
 * modules-meta.ts): solo un grupo abierto a la vez, el de la página activa se
 * abre solo al navegar — esto es puramente visual, no cambia qué ve cada rol.
 */
export function RoleNav({ modulosPermitidos, rol, onNavigate }: RoleNavProps) {
  const location = useLocation();
  const esRolTransversal = ROLES_CON_DASHBOARD.includes(rol);
  const items = MODULES_META.filter((m) => {
    if (m.path === "/") return esRolTransversal;
    if (!modulosPermitidos.includes(m.slug)) return false;
    if (m.roles && !esRolTransversal && !m.roles.includes(rol)) return false;
    return true;
  });

  function grupoDeLaRuta(pathname: string) {
    return NAV_GROUPS.find((g) => g.paths.includes(pathname))?.slug ?? null;
  }

  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(() => grupoDeLaRuta(location.pathname));

  useEffect(() => {
    const activo = grupoDeLaRuta(location.pathname);
    if (activo) setGrupoAbierto(activo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const pathsAgrupados = new Set(NAV_GROUPS.flatMap((g) => g.paths));
  const itemsSueltos = items.filter((i) => !pathsAgrupados.has(i.path));
  const gruposConItems = NAV_GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) => g.paths.includes(i.path)),
  })).filter((g) => g.items.length > 0);

  function claseLink({ isActive }: { isActive: boolean }) {
    return ["flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors", isActive ? CLASE_LINK_ACTIVO : CLASE_LINK_INACTIVO].join(" ");
  }

  return (
    <nav className="flex flex-col gap-1">
      {itemsSueltos.map((item) => (
        <NavLink key={item.path} to={item.path} end={item.path === "/"} onClick={onNavigate} className={claseLink}>
          <span aria-hidden>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}

      {gruposConItems.map((grupo) => {
        const abierto = grupoAbierto === grupo.slug;
        return (
          <div key={grupo.slug} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setGrupoAbierto((actual) => (actual === grupo.slug ? null : grupo.slug))}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40"
            >
              <span aria-hidden>{grupo.icon}</span>
              <span className="flex-1 text-left">{grupo.label}</span>
              <span aria-hidden className="text-xs">
                {abierto ? "▾" : "▸"}
              </span>
            </button>
            {abierto && (
              <div className="ml-3 flex flex-col gap-1 border-l border-brand-vanilla-dark pl-2 dark:border-brand-green-700">
                {grupo.items.map((item) => (
                  <NavLink key={item.path} to={item.path} onClick={onNavigate} className={claseLink}>
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
