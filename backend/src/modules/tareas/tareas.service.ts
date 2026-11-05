import { Errors } from "../../shared/utils/app-error";
import * as usuariosRepo from "../general/usuarios/usuarios.repository";
import * as repo from "./tareas.repository";
import type { EstadoTarea, InstanciaTarea, PlantillaTarea } from "./tareas.types";

/**
 * Resuelve las plantillas aplicables para `usuarioId`/`rolId` en `fecha` y
 * genera (perezoso, idempotente — ver repo.generarInstanciasFaltantes) las
 * instancias que todavía no existan. Compartido por obtenerTareasDelDia
 * (un usuario viendo su propio día) y obtenerVistaCruzada (Root/Super Root
 * viendo el día de varios usuarios a la vez) para no duplicar el camino.
 *
 * `hoy` (YYYY-MM-DD, resuelto por el caller con repo.obtenerFechaHoy) corta
 * la generación para una fecha futura: si `fecha > hoy` todavía no llegó ese
 * día, así que no hay nada que generar (lo contrario fabricaría filas reales
 * para un día que aún no pasó — ver Review Focus del plan). La comparación
 * lexicográfica de strings ISO ordena igual que la cronológica.
 */
async function generarInstanciasParaUsuario(
  usuarioId: string,
  rolId: number,
  fecha: string,
  hoy: string,
): Promise<void> {
  if (fecha > hoy) return;
  const plantillas = await repo.listarPlantillasAplicables(fecha, usuarioId, rolId);
  await repo.generarInstanciasFaltantes(plantillas, usuarioId, fecha);
}

export async function obtenerTareasDelDia(usuarioId: string, rolId: number, fecha: string): Promise<InstanciaTarea[]> {
  const hoy = await repo.obtenerFechaHoy();
  await generarInstanciasParaUsuario(usuarioId, rolId, fecha, hoy);
  // Ya vienen ordenadas por `orden` (JOIN a la plantilla) — ver
  // tareas.repository.ts::listarInstanciasDeUsuario.
  return repo.listarInstanciasDeUsuario(usuarioId, fecha);
}

export async function cambiarEstado(params: {
  instanciaId: string;
  estado: EstadoTarea;
  llamadorId: string;
  llamadorPuedeGestionar: boolean;
}): Promise<InstanciaTarea> {
  const instancia = await repo.obtenerInstanciaPorId(params.instanciaId);
  if (!instancia) throw Errors.notFound("Tarea no encontrada");

  // Sin tareas.gestionar, solo se puede tocar el estado de la propia tarea
  // — con tareas.gestionar (Root/Super Root), se puede sobreescribir la de
  // cualquiera (Spec §2/§3).
  if (!params.llamadorPuedeGestionar && instancia.usuarioId !== params.llamadorId) {
    throw Errors.forbidden("No tiene permiso para cambiar el estado de esta tarea");
  }

  // Sin tareas.gestionar, solo se puede tocar el estado del día de HOY — ni
  // pasado (marcar retroactivamente) ni futuro. Con tareas.gestionar, el
  // guard de dueño de arriba ya deja sobreescribir cualquier día, así que
  // esta restricción no le aplica.
  if (!params.llamadorPuedeGestionar) {
    const hoy = await repo.obtenerFechaHoy();
    if (instancia.fecha !== hoy) {
      throw Errors.forbidden("Solo se puede cambiar el estado de las tareas del día de hoy");
    }
  }

  // actualizado_por_id siempre es quien hizo el cambio (puede ser el dueño o
  // quien gestiona sobreescribiendo), nunca el dueño de la instancia.
  const actualizada = await repo.actualizarEstadoInstancia(params.instanciaId, params.estado, params.llamadorId);
  // No debería pasar (ya se confirmó que existe arriba), pero una plantilla
  // nunca se borra físicamente así que esto solo cubriría una carrera
  // imposible hoy — se deja el guard por las dudas, igual que el resto del
  // código del módulo no confía en que un segundo query siga viendo lo que
  // vio el primero.
  if (!actualizada) throw Errors.notFound("Tarea no encontrada");
  return actualizada;
}

/**
 * Exactamente un destino (Spec §1, primer CHECK de `tareas_plantilla`): la
 * plantilla es de un rol completo o de un usuario puntual, nunca ambos ni
 * ninguno. Se valida acá, antes del INSERT/UPDATE, para devolver un 400
 * entendible en vez de que la DB lo rechace con un error crudo.
 */
function validarDestino(rolId: number | null | undefined, usuarioId: string | null | undefined): void {
  const tieneRol = rolId !== null && rolId !== undefined;
  const tieneUsuario = usuarioId !== null && usuarioId !== undefined;
  if (tieneRol === tieneUsuario) {
    throw Errors.badRequest("La plantilla debe tener exactamente uno: rol o usuario, no ambos ni ninguno");
  }
}

/**
 * Combinación tipo/días-o-fecha (Spec §1, segundo CHECK de
 * `tareas_plantilla`): 'semanal' exige al menos un día de la semana y
 * ninguna fecha única; 'unica' exige la fecha y ningún día de la semana.
 *
 * Un `diasSemana: []` para 'semanal' se rechaza acá explícitamente: el
 * repositorio (`diasSemanaACsv`) lo convierte a `NULL` al guardar — mismo
 * resultado que no mandar ningún día — lo que violaría el CHECK de la DB
 * (`dias_semana IS NOT NULL`) con un error crudo de MySQL en vez de un 400
 * entendible. "Semanal sin ningún día" no es un estado de negocio válido
 * (nunca generaría ninguna instancia), así que no hay nada que preservar
 * ahí: se trata igual que "no se mandaron días".
 */
function validarRecurrencia(
  tipoRecurrencia: "semanal" | "unica",
  diasSemana: number[] | null | undefined,
  fechaUnica: string | null | undefined,
): void {
  if (tipoRecurrencia === "semanal") {
    if (!diasSemana || diasSemana.length === 0) {
      throw Errors.badRequest("Una plantilla semanal necesita al menos un día de la semana");
    }
    if (fechaUnica) {
      throw Errors.badRequest("Una plantilla semanal no debe tener fecha única");
    }
  } else {
    if (!fechaUnica) {
      throw Errors.badRequest("Una plantilla única necesita una fecha");
    }
    if (diasSemana && diasSemana.length > 0) {
      throw Errors.badRequest("Una plantilla única no debe tener días de la semana");
    }
  }
}

export async function crearPlantilla(
  datos: Omit<PlantillaTarea, "id" | "activo">,
  creadoPorId: string,
): Promise<PlantillaTarea> {
  validarDestino(datos.rolId, datos.usuarioId);
  validarRecurrencia(datos.tipoRecurrencia, datos.diasSemana, datos.fechaUnica);
  return repo.crearPlantilla({ ...datos, creadoPorId });
}

export async function editarPlantilla(
  id: string,
  cambios: Partial<Pick<PlantillaTarea, "titulo" | "descripcion" | "orden" | "activo" | "diasSemana" | "fechaUnica">>,
): Promise<PlantillaTarea> {
  const existente = await repo.obtenerPlantillaPorId(id);
  if (!existente) throw Errors.notFound("Plantilla no encontrada");

  // `tipoRecurrencia` no está en `cambios` (no es editable — ver Task 2): se
  // revalida la combinación resultante contra el tipo ya fijado de la
  // plantilla, con el valor nuevo si vino en `cambios` o el que ya tenía si
  // no vino.
  const diasSemanaFinal = cambios.diasSemana !== undefined ? cambios.diasSemana : existente.diasSemana;
  const fechaUnicaFinal = cambios.fechaUnica !== undefined ? cambios.fechaUnica : existente.fechaUnica;
  validarRecurrencia(existente.tipoRecurrencia, diasSemanaFinal, fechaUnicaFinal);

  const actualizada = await repo.actualizarPlantilla(id, cambios);
  if (!actualizada) throw Errors.notFound("Plantilla no encontrada");
  return actualizada;
}

export async function listarPlantillas(filtros: { rolId?: number; usuarioId?: string }): Promise<PlantillaTarea[]> {
  return repo.listarPlantillas(filtros);
}

/**
 * Vista cruzada de Root/Super Root: igual que `repo.listarInstanciasVista`,
 * pero generando antes las instancias que falten de cada usuario afectado
 * por `filtros` (mismo camino perezoso que `obtenerTareasDelDia`) — así la
 * vista nunca muestra un día vacío solo porque ese usuario todavía no abrió
 * su propia pestaña "Mis tareas" hoy.
 *
 * "Afectado por los filtros" solo considera usuarios activos (ni
 * desactivados ni borrados): generar instancias nuevas para alguien
 * inactivo contradiría el Review Focus del plan ("usuario cuyo rol cambió o
 * fue desactivado deja de generar instancias nuevas de inmediato"). Sus
 * instancias ya generadas antes de desactivarse siguen apareciendo igual,
 * porque `listarInstanciasVista` no filtra por `activo` del usuario.
 */
export async function obtenerVistaCruzada(
  fecha: string,
  filtros: { rolId?: number; usuarioId?: string },
): Promise<(InstanciaTarea & { usuarioNombre: string })[]> {
  const usuarios = await usuariosRepo.listUsuarios();
  const afectados = usuarios.filter((usuario) => {
    if (!usuario.activo || usuario.deleted_at) return false;
    if (filtros.usuarioId !== undefined && usuario.id !== filtros.usuarioId) return false;
    if (filtros.rolId !== undefined && usuario.rol_id !== filtros.rolId) return false;
    return true;
  });

  // Resuelto una sola vez antes del loop (no una consulta por usuario, que
  // serían N consultas redundantes para el mismo valor).
  const hoy = await repo.obtenerFechaHoy();
  for (const usuario of afectados) {
    await generarInstanciasParaUsuario(usuario.id, usuario.rol_id, fecha, hoy);
  }

  return repo.listarInstanciasVista(fecha, filtros);
}
