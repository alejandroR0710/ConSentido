import { Navigate } from "react-router-dom";
import { useAuth } from "../../../shared/auth/useAuth";
import { MODULES_META, ROLE_HOME, ROLES_CON_DASHBOARD } from "../../../shared/layout/modules-meta";
import { DashboardPage } from "./DashboardPage";

/**
 * "/" no siempre es el Dashboard: solo los roles con visión transversal del
 * negocio lo necesitan (ver ROLES_CON_DASHBOARD). El resto entra directo a su
 * pantalla de trabajo (ROLE_HOME), sin pasar por una vista genérica que no usan.
 */
export function HomeRoute() {
  const { usuario } = useAuth();
  if (!usuario) return null;

  if (ROLES_CON_DASHBOARD.includes(usuario.rol)) {
    return <DashboardPage />;
  }

  const destino =
    ROLE_HOME[usuario.rol] ??
    MODULES_META.find(
      (m) => m.slug !== "general" && usuario.modulos.includes(m.slug) && (!m.roles || m.roles.includes(usuario.rol)),
    )?.path ??
    "/login";

  return <Navigate to={destino} replace />;
}
