import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  exportarReporteController,
  obtenerCierreCajaController,
  obtenerConciliacionController,
  obtenerGastosController,
  obtenerPrestamosController,
  obtenerResumenController,
  obtenerVentasController,
  obtenerVentasPorTipoController,
} from "./reportes.controller";

export const reportesRouter = Router();
reportesRouter.use(authMiddleware);

reportesRouter.get(
  "/resumen",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerResumenController),
);

reportesRouter.get(
  "/ventas",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerVentasController),
);

reportesRouter.get(
  "/ventas-por-tipo",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerVentasPorTipoController),
);

reportesRouter.get(
  "/gastos",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerGastosController),
);

reportesRouter.get(
  "/cierre-caja",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerCierreCajaController),
);

reportesRouter.get(
  "/prestamos",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerPrestamosController),
);

reportesRouter.get(
  "/conciliacion",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(obtenerConciliacionController),
);

// Task 9 — un único endpoint parametrizado de export a Excel para los 7
// reportes (en vez de 7 rutas `/…/exportar` separadas); `:tipo` se valida
// con `reportesExportarTipoSchema` (Zod enum) dentro del controller, que
// devuelve 400 (VALIDATION_ERROR, ver error-handler.ts) para cualquier valor
// fuera de los 7 slugs soportados. Dos segmentos (`/:tipo/exportar`), nunca
// colisiona con las rutas estáticas de un solo segmento de arriba.
reportesRouter.get(
  "/:tipo/exportar",
  requirePermission("general.dashboard.analytics.ver"),
  asyncHandler(exportarReporteController),
);
