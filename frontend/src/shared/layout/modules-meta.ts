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
  // Cuentas con pago "administrativo" — no cuentan en Caja General, su propio
  // historial aparte (ver el guard en HistorialAdministrativoPage.tsx).
  {
    slug: "migao",
    label: "Historial Administrativo",
    path: "/migao/historial-administrativo",
    icon: "🗂️",
    roles: ["Super Root", "Root"],
  },
  { slug: "general", label: "Dashboard", path: "/", icon: "🏠" },
  { slug: "general", label: "Caja General", path: "/caja", icon: "💰", roles: ["Cajero"] },
  // Historial de Caja/Cocina/Mesero ya no viven en el sidebar: cada módulo
  // tiene su propio botón "Historial" arriba (CajaPage/CocinaPage/MeseroPage),
  // las rutas siguen existiendo en App.tsx, solo se llega por ese botón.
  { slug: "insumos", label: "Insumos", path: "/insumos", icon: "📦" },
  { slug: "talleres", label: "Talleres", path: "/talleres", icon: "🎨" },
  { slug: "con_sentido", label: "Con Sentido", path: "/con-sentido", icon: "🛍️" },
  { slug: "migao", label: "Mesero", path: "/mesero", icon: "📝", roles: ["Mesero"] },
  { slug: "migao", label: "Cocina", path: "/cocina", icon: "🍳", roles: ["Cocina"] },
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

export interface NavGroupMeta {
  slug: string;
  label: string;
  icon: string;
  /** Paths de MODULES_META que pertenecen a este grupo, en el orden a mostrar. */
  paths: string[];
}

/**
 * Agrupamiento puramente visual del sidebar (acordeón): no cambia el acceso
 * de nadie, solo cómo se organiza. MODULES_META se queda como array plano
 * (HomeRoute.tsx depende de esa forma para calcular a dónde aterriza cada
 * rol), este es un mapeo aparte que RoleNav usa para decidir qué items van
 * agrupados bajo un encabezado y cuáles quedan sueltos (Dashboard, Caja
 * General/Historial de Caja quedan sueltos por no estar en ningún grupo).
 */
export const NAV_GROUPS: NavGroupMeta[] = [
  {
    slug: "migao-grupo",
    label: "Migao",
    icon: "🍽️",
    paths: ["/migao", "/cocina", "/menu", "/mesero", "/migao/historial", "/migao/historial-administrativo"],
  },
  {
    slug: "con-sentido-grupo",
    label: "Con Sentido",
    icon: "🛍️",
    paths: ["/con-sentido", "/pedidos", "/talleres"],
  },
  { slug: "insumos-grupo", label: "Insumos", icon: "📦", paths: ["/insumos"] },
];
