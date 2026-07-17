export interface ModuloMeta {
  slug: string;
  label: string;
  path: string;
  icon: string; // emoji simple: se reemplaza fácilmente por un set de íconos real más adelante
  /**
   * Si se define, SOLO estos roles ven esta entrada (Super Root siempre la ve,
   * por su visión transversal). Necesario porque Mesero/Migao/Cocina comparten
   * el mismo slug "migao" pero son pantallas de sub-roles distintos: el acceso
   * a nivel de módulo no alcanza para saber cuál debe ver cada quién.
   */
  roles?: string[];
}

export const MODULES_META: ModuloMeta[] = [
  { slug: "migao", label: "Caja Migao", path: "/migao", icon: "🍽️", roles: ["Cajero"] },
  // Solo Root/Super Root: el Cajero cobra desde "Caja Migao" pero no audita el
  // historial ya cobrado/cancelado (ver el guard en MigaoHistorialPage.tsx).
  { slug: "migao", label: "Historial Migao", path: "/migao/historial", icon: "🧾", roles: ["Super Root", "Root"] },
  { slug: "general", label: "Dashboard", path: "/", icon: "🏠" },
  { slug: "general", label: "Caja General", path: "/caja", icon: "💰", roles: ["Cajero"] },
  { slug: "general", label: "Historial de Caja", path: "/caja/historial", icon: "📅", roles: ["Cajero"] },
  { slug: "insumos", label: "Insumos", path: "/insumos", icon: "📦" },
  { slug: "talleres", label: "Talleres", path: "/talleres", icon: "🎨" },
  { slug: "con_sentido", label: "Con Sentido", path: "/con-sentido", icon: "🛍️" },
  { slug: "migao", label: "Mesero", path: "/mesero", icon: "📝", roles: ["Mesero"] },
  { slug: "migao", label: "Mi historial", path: "/mesero/historial", icon: "🧾", roles: ["Mesero"] },
  { slug: "migao", label: "Cocina", path: "/cocina", icon: "🍳", roles: ["Cocina"] },
  { slug: "migao", label: "Historial", path: "/cocina/historial", icon: "🧾", roles: ["Cocina"] },
  { slug: "migao", label: "Menú", path: "/menu", icon: "🗂️", roles: ["Administrador"] },
  { slug: "pedidos", label: "Pedidos", path: "/pedidos", icon: "📋" },
];

/**
 * No todos los roles necesitan una vista general: Mesero/Cocina/Cajero tienen
 * un único trabajo puntual y entran directo a su pantalla. Dashboard queda
 * reservado a roles con visión transversal del negocio. Estos mismos roles
 * también saltan el filtro por `roles` de MODULES_META (ven todo lo de su
 * módulo, no solo lo suyo). "Root" ve exactamente lo mismo que "Super Root"
 * (todas las vistas) — lo único que no tiene son los permisos de reinicio/
 * borrado de historial, que ya se filtran aparte a nivel de botón/backend.
 */
export const ROLES_CON_DASHBOARD = ["Super Root", "Root"];

/** A dónde aterriza cada rol al iniciar sesión, en vez del Dashboard genérico. */
export const ROLE_HOME: Record<string, string> = {
  Cajero: "/caja",
  Cocina: "/cocina",
  Mesero: "/mesero",
  Administrador: "/menu",
};
