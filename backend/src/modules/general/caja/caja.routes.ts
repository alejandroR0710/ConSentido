import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { requirePermission } from "../../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import {
  abrirTurnoController,
  actualizarCategoriaGastoController,
  actualizarProveedorController,
  agregarMovimientoHistoricoController,
  anularVentaController,
  borrarHistorialDiaController,
  borrarTurnoController,
  cerrarTurnoController,
  crearCategoriaGastoController,
  crearProveedorController,
  desactivarProveedorController,
  editarMetodoPagoMovimientoController,
  editarMovimientoHistoricoController,
  listarCategoriasGastoController,
  listarEdicionesDelDiaController,
  listarProveedoresController,
  obtenerHistorialCajaController,
  obtenerMovimientosDelDiaController,
  obtenerResumenTurnoController,
  obtenerTurnoAbiertoController,
  obtenerAcumuladoTotalController,
  obtenerTurnosPorFechaController,
  registrarEgresoAcumuladoController,
  registrarEgresoController,
  registrarIngresoController,
  resetearCajaController,
} from "./caja.controller";

export const cajaRouter = Router();

cajaRouter.use(authMiddleware);

cajaRouter.get("/turno-actual", requirePermission("general.caja.ver"), asyncHandler(obtenerTurnoAbiertoController));
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

// Egreso contra el ACUMULADO TOTAL histórico (no un turno ni un día) — no se
// le da al Cajero, a diferencia del egreso normal de arriba.
cajaRouter.get("/acumulado", requirePermission("general.caja.ver"), asyncHandler(obtenerAcumuladoTotalController));
cajaRouter.post(
  "/egresos-acumulado",
  requirePermission("general.caja.registrar_egreso_acumulado"),
  asyncHandler(registrarEgresoAcumuladoController),
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
cajaRouter.patch(
  "/categorias-gasto/:id",
  requirePermission("general.caja.administrar_categorias"),
  asyncHandler(actualizarCategoriaGastoController),
);

cajaRouter.get(
  "/proveedores",
  requirePermission("general.caja.ver"),
  asyncHandler(listarProveedoresController),
);
cajaRouter.post(
  "/proveedores",
  requirePermission("general.caja.administrar_categorias"),
  asyncHandler(crearProveedorController),
);
cajaRouter.patch(
  "/proveedores/:id",
  requirePermission("general.caja.administrar_categorias"),
  asyncHandler(actualizarProveedorController),
);
cajaRouter.delete(
  "/proveedores/:id",
  requirePermission("general.caja.administrar_categorias"),
  asyncHandler(desactivarProveedorController),
);

cajaRouter.get("/historial", requirePermission("general.caja.ver"), asyncHandler(obtenerHistorialCajaController));
cajaRouter.get(
  "/turnos-por-fecha",
  requirePermission("general.caja.ver"),
  asyncHandler(obtenerTurnosPorFechaController),
);
// Detalle de movimientos de un día del historial (de qué es cada ingreso/egreso).
cajaRouter.get(
  "/movimientos-por-fecha",
  requirePermission("general.caja.ver"),
  asyncHandler(obtenerMovimientosDelDiaController),
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

// Reset exclusivo de Super Root: no borra historial, fuerza el cierre del
// turno abierto sin conteo físico y borra sus egresos (ver caja.service.ts).
cajaRouter.post("/reset", requirePermission("general.caja.resetear"), asyncHandler(resetearCajaController));

// Ajustar el historial de un día ya cerrado (Root/Super Root, ver
// caja.service.ts): agregar un movimiento retroactivo, o corregir uno
// existente — ambos quedan auditados en movimientos_caja_ediciones.
cajaRouter.post(
  "/historial/:fecha/movimientos",
  requirePermission("general.caja.editar_movimiento"),
  asyncHandler(agregarMovimientoHistoricoController),
);
cajaRouter.patch(
  "/movimientos/:id/historico",
  requirePermission("general.caja.editar_movimiento"),
  asyncHandler(editarMovimientoHistoricoController),
);
cajaRouter.get(
  "/historial/:fecha/ediciones",
  requirePermission("general.caja.ver"),
  asyncHandler(listarEdicionesDelDiaController),
);

// Anular una venta (Migao o Con Sentido) desde cualquier día del historial —
// Root o Super Root (ver caja.service.ts::anularVenta).
cajaRouter.post(
  "/movimientos/:id/anular-venta",
  requirePermission("general.caja.editar_movimiento"),
  asyncHandler(anularVentaController),
);
