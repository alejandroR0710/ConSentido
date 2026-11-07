import { Request, Response, Router } from "express";
import { z } from "zod";
import { pool } from "../../shared/db/pool";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";
import { requirePermission, tienePermiso } from "../../shared/middlewares/rbac.middleware";
import { asyncHandler } from "../../shared/utils/async-handler";
import { created, ok } from "../../shared/utils/response";
import * as service from "./tareas.service";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// `?fecha=` vacío (query present pero sin valor) llega a Zod como "" — se
// normaliza a `undefined` ANTES de validar el formato, así resolverFecha lo
// trata igual que "no vino" (resuelve "hoy"), en vez de que el regex de abajo
// lo rechace con un 400 por un valor que el caller nunca quiso mandar.
const fechaOpcionalSchema = z.preprocess(
  (valor) => (valor === "" ? undefined : valor),
  z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
);

const diasSemanaSchema = z.array(z.number().int().min(1).max(7)).nullable();

const miasQuerySchema = z.object({ fecha: fechaOpcionalSchema });

const vistaQuerySchema = z.object({
  fecha: fechaOpcionalSchema,
  rolId: z.coerce.number().int().positive().optional(),
  usuarioId: z.string().min(1).optional(),
});

const plantillasQuerySchema = z.object({
  rolId: z.coerce.number().int().positive().optional(),
  usuarioId: z.string().min(1).optional(),
});

const cambiarEstadoSchema = z.object({
  estado: z.enum(["pendiente", "en_progreso", "completada", "omitida"]),
});

// Combinación rol/usuario y tipo/días-o-fecha NO se valida acá (eso es regla
// de negocio, no de forma): `tareas.service.ts::validarDestino` y
// `validarRecurrencia` ya la chequean y devuelven un 400 entendible — este
// esquema solo valida tipos/formato de cada campo suelto.
const crearPlantillaSchema = z.object({
  titulo: z.string().min(1).max(150),
  descripcion: z.string().nullable().optional(),
  rolId: z.number().int().positive().nullable().optional(),
  usuarioId: z.string().min(1).nullable().optional(),
  tipoRecurrencia: z.enum(["semanal", "unica"]),
  diasSemana: diasSemanaSchema.optional(),
  fechaUnica: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)").nullable().optional(),
  orden: z.number().int().optional(),
});

// `tipoRecurrencia` deliberadamente ausente — no es editable (ver Task 2/3).
const editarPlantillaSchema = z.object({
  titulo: z.string().min(1).max(150).optional(),
  descripcion: z.string().nullable().optional(),
  orden: z.number().int().optional(),
  activo: z.boolean().optional(),
  diasSemana: diasSemanaSchema.optional(),
  fechaUnica: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (YYYY-MM-DD)").nullable().optional(),
});

const scrumQuerySchema = z.object({ fecha: fechaOpcionalSchema });

// "No vacío" real (tras trim) lo revalida tareas.service.ts::crearTareaScrum
// — acá solo se valida tipo/forma, igual que crearPlantillaSchema arriba.
const crearTareaScrumSchema = z.object({
  titulo: z.string().min(1),
  area: z.string().min(1),
  descripcion: z.string().nullable().optional(),
  fecha: fechaOpcionalSchema,
});

/**
 * "Hoy" para `GET /mias` y `GET /vista` cuando `fecha` no vino: se resuelve
 * contra la sesión MySQL (fija en -05:00, ver pool.ts), nunca con
 * `new Date()` de Node (que puede correr en otra zona horaria según el host).
 */
async function resolverFecha(fecha: string | undefined): Promise<string> {
  if (fecha) return fecha;
  const resultado = await pool.query<{ hoy: string }>("SELECT CURDATE() AS hoy");
  return resultado.rows[0].hoy;
}

export const tareasRouter = Router();
tareasRouter.use(authMiddleware);

tareasRouter.get(
  "/mias",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fecha } = miasQuerySchema.parse(req.query);
    const fechaResuelta = await resolverFecha(fecha);
    const instancias = await service.obtenerTareasDelDia(req.auth!.usuarioId, req.auth!.rolId, fechaResuelta);
    return ok(res, instancias);
  }),
);

tareasRouter.patch(
  "/instancias/:id/estado",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    const { estado } = cambiarEstadoSchema.parse(req.body);
    // Calculado acá (no reimplementado): el service solo recibe el booleano
    // ya resuelto y decide con él si puede tocar la tarea de otro usuario.
    const llamadorPuedeGestionar = await tienePermiso(req.auth!.rolId, "tareas.gestionar");
    const instancia = await service.cambiarEstado({
      instanciaId: req.params.id,
      estado,
      llamadorId: req.auth!.usuarioId,
      llamadorPuedeGestionar,
    });
    return ok(res, instancia);
  }),
);

tareasRouter.get(
  "/plantillas",
  requirePermission("tareas.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const filtros = plantillasQuerySchema.parse(req.query);
    const plantillas = await service.listarPlantillas(filtros);
    return ok(res, plantillas);
  }),
);

tareasRouter.post(
  "/plantillas",
  requirePermission("tareas.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = crearPlantillaSchema.parse(req.body);
    const plantilla = await service.crearPlantilla(
      {
        titulo: datos.titulo,
        descripcion: datos.descripcion ?? null,
        rolId: datos.rolId ?? null,
        usuarioId: datos.usuarioId ?? null,
        tipoRecurrencia: datos.tipoRecurrencia,
        diasSemana: datos.diasSemana ?? null,
        fechaUnica: datos.fechaUnica ?? null,
        orden: datos.orden ?? 0,
      },
      req.auth!.usuarioId,
    );
    return created(res, plantilla);
  }),
);

tareasRouter.patch(
  "/plantillas/:id",
  requirePermission("tareas.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const cambios = editarPlantillaSchema.parse(req.body);
    const plantilla = await service.editarPlantilla(req.params.id, cambios);
    return ok(res, plantilla);
  }),
);

tareasRouter.get(
  "/vista",
  requirePermission("tareas.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fecha, ...filtros } = vistaQuerySchema.parse(req.query);
    const fechaResuelta = await resolverFecha(fecha);
    const vista = await service.obtenerVistaCruzada(fechaResuelta, filtros);
    return ok(res, vista);
  }),
);

// ---------------------------------------------------------------------------
// Tablero compartido por área (tipo Scrum).
// ---------------------------------------------------------------------------

tareasRouter.get(
  "/scrum",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fecha } = scrumQuerySchema.parse(req.query);
    const fechaResuelta = await resolverFecha(fecha);
    const tablero = await service.listarTableroDelDia(fechaResuelta, req.auth!.usuarioId);
    return ok(res, tablero);
  }),
);

tareasRouter.post(
  "/scrum",
  requirePermission("tareas.gestionar"),
  asyncHandler(async (req: Request, res: Response) => {
    const datos = crearTareaScrumSchema.parse(req.body);
    const fechaResuelta = await resolverFecha(datos.fecha);
    const tarea = await service.crearTareaScrum(
      {
        titulo: datos.titulo,
        area: datos.area,
        descripcion: datos.descripcion ?? null,
        fecha: fechaResuelta,
      },
      req.auth!.usuarioId,
    );
    return created(res, tarea);
  }),
);

tareasRouter.post(
  "/scrum/:id/unirse",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    await service.unirseATareaScrum(req.params.id, req.auth!.usuarioId);
    return ok(res, { ok: true });
  }),
);

tareasRouter.post(
  "/scrum/:id/salir",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    await service.salirDeTareaScrum(req.params.id, req.auth!.usuarioId);
    return ok(res, { ok: true });
  }),
);

tareasRouter.post(
  "/scrum/:id/cerrar",
  requirePermission("tareas.ver_propias"),
  asyncHandler(async (req: Request, res: Response) => {
    // Calculado acá (no reimplementado): mismo patrón que
    // PATCH /instancias/:id/estado arriba — el service solo recibe el
    // booleano ya resuelto y decide con él si puede cerrar la de otro.
    const llamadorPuedeGestionar = await tienePermiso(req.auth!.rolId, "tareas.gestionar");
    const tarea = await service.cerrarTareaScrum({
      tareaId: req.params.id,
      llamadorId: req.auth!.usuarioId,
      llamadorPuedeGestionar,
    });
    return ok(res, tarea);
  }),
);
