import { NavLink } from "react-router-dom";
import { MODULES_META, ROLES_CON_DASHBOARD } from "./modules-meta";

interface RoleNavProps {
  modulosPermitidos: string[];
  rol: string;
  orientation: "vertical" | "horizontal";
}

/**
 * Renderiza solo las pantallas que el rol activo puede realmente usar.
 * El Dashboard ("/") es la excepción: no es "un módulo más", es una vista transversal
 * que solo tiene sentido para roles con visión de todo el negocio (ROLES_CON_DASHBOARD).
 * Se distingue por su path, no por su slug — Caja también vive bajo el slug "general"
 * (así se modeló el permiso) pero sí debe verla el Cajero, no solo Super Root.
 * Además, cuando una entrada declara `roles` (Mesero/Migao/Cocina comparten el
 * slug "migao" pero son pantallas de sub-roles distintos), solo esos roles la ven
 * — el acceso a nivel de módulo no alcanza para saber cuál pantalla es de cada quién.
 * El mismo listado alimenta el sidebar de escritorio y la barra inferior de mobile,
 * así que agregar un módulo nuevo no requiere tocar el layout responsive.
 */
export function RoleNav({ modulosPermitidos, rol, orientation }: RoleNavProps) {
  const esRolTransversal = ROLES_CON_DASHBOARD.includes(rol);
  const items = MODULES_META.filter((m) => {
    if (m.path === "/") return esRolTransversal;
    if (!modulosPermitidos.includes(m.slug)) return false;
    if (m.roles && !esRolTransversal && !m.roles.includes(rol)) return false;
    return true;
  });

  const containerClass =
    orientation === "vertical"
      ? "flex flex-col gap-1"
      : "flex flex-row justify-around";

  return (
    <nav className={containerClass}>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) =>
            [
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              orientation === "horizontal" ? "flex-col text-xs gap-0.5" : "",
              isActive
                ? "bg-brand-green-700 text-brand-vanilla"
                : "text-brand-green-700 hover:bg-brand-green-50 dark:text-brand-vanilla dark:hover:bg-brand-green-700/40",
            ].join(" ")
          }
        >
          <span aria-hidden>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
