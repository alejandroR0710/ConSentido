import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import {
  abrirTurnoController,
  borrarHistorialDiaController,
  borrarTurnoController,
  cerrarTurnoController,
  crearCategoriaGastoController,
  editarMetodoPagoMovimientoController,
  listarCategoriasGastoController,
  obtenerHistorialCajaController,
  obtenerProyeccionAperturaController,
  obtenerResumenTurnoController,
  obtenerTurnoAbiertoController,
  obtenerTurnosPorFechaController,
  registrarEgresoController,
  registrarIngresoController,
  resetearCajaController,
} from "./caja.controller";

export const cajaRouter = Router();

cajaRouter.use(authMiddleware);

cajaRouter.get("/turno-actual", requirePermission("general.caja.ver"), asyncHandler(obtenerTurnoAbiertoController));
// Vista previa de con cuánto abrirá el próximo turno (heredado del último cierre),
// para mostrarla antes de que el cajero confirme "Abrir turno".
cajaRouter.get(
  "/proxima-apertura",
  requirePermission("general.caja.ver"),
  asyncHandler(obtenerProyeccionAperturaController),
);
cajaRouter.post("/turnos", requirePermission("general.caja.abrir_turno"), asyncHandler(abrirTurnoController));
cajaRouter.patch(
  "/turnos/:id/cerrar",
  requirePermission("general.caja.cerrar_turno"),
  asyncHandler(cerrarTurnoController),
);
cajaRouter.get("/turnos/:id/resumen", requirePermission("general.caja.ver"), asyncHandler(obtenerResumenTurnoController));

cajaRouter.post(
  "/ingresos",
  requirePermission("general.caja.registrar_ingreso"),
  asyncHandler(registrarIngresoController),
);
cajaRouter.post(
  "/egresos",
  requirePermission("general.caja.registrar_egreso"),
  asyncHandler(registrarEgresoController),
);

cajaRouter.get(
  "/categorias-gasto",
  requirePermission("general.caja.ver"),
  asyncHandler(listarCategoriasGastoController),
);
cajaRouter.post(
  "/categorias-gasto",
  requirePermission("general.caja.administrar_categorias"),
  asyncHandler(crearCategoriaGastoController),
);

cajaRouter.get("/historial", requirePermission("general.caja.ver"), asyncHandler(obtenerHistorialCajaController));
cajaRouter.get(
  "/turnos-por-fecha",
  requirePermission("general.caja.ver"),
  asyncHandler(obtenerTurnosPorFechaController),
);

// Borrados permanentes exclusivos de Super Root (ver caja.service.ts): a
// diferencia del reset, estos SÍ borran datos y no se pueden deshacer.
cajaRouter.post(
  "/historial/borrar-dia",
  requirePermission("general.caja.borrar_historial"),
  asyncHandler(borrarHistorialDiaController),
);
cajaRouter.delete(
  "/turnos/:id",
  requirePermission("general.caja.borrar_historial"),
  asyncHandler(borrarTurnoController),
);

// Corrección de método de pago exclusiva de Super Root (ver caja.service.ts).
cajaRouter.patch(
  "/movimientos/:id/metodo-pago",
  requirePermission("general.caja.editar_movimiento"),
  asyncHandler(editarMetodoPagoMovimientoController),
);

// Reset exclusivo de Super Root: no borra historial, solo hace que el próximo
// turno arranque en 0/0 en vez de heredar el saldo anterior (ver caja.service.ts).
cajaRouter.post("/reset", requirePermission("general.caja.resetear"), asyncHandler(resetearCajaController));
