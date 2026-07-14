/** Roles con visión transversal de todo el negocio (ver también
 *  ROLES_CON_DASHBOARD en shared/layout/modules-meta.ts). "Root" ve y puede
 *  hacer lo mismo que "Super Root" en el día a día (ej. corregir el método de
 *  pago de un movimiento) — la única diferencia son los botones de reinicio/
 *  borrado de historial, que se siguen comprobando aparte contra
 *  rol === "Super Root" exactamente, nunca con este helper. */
const ROLES_ACCESO_TOTAL = ["Super Root", "Root"];

export function tieneAccesoTotal(rol: string | undefined): boolean {
  return !!rol && ROLES_ACCESO_TOTAL.includes(rol);
}
