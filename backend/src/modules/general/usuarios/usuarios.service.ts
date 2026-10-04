import bcrypt from "bcryptjs";
import { Errors } from "../../../shared/utils/app-error";
import * as repo from "./usuarios.repository";
import { CrearUsuarioInput, EditarUsuarioInput } from "./usuarios.schema";

const SALT_ROUNDS = 10;

/** Root ve/edita todo igual que Super Root, EXCEPTO estas cuentas: crear, editar
 *  (incluido reasignar el rol) o eliminar un Root/Super Root es exclusivo de
 *  Super Root — evita que un Root se autoescale o desactive a otro. */
const ROLES_PROTEGIDOS = new Set(["Root", "Super Root"]);

export interface ActorUsuario {
  usuarioId: string;
  rolId: number;
}

function normalizarIdentificador(tipo: "email" | "documento", valor: string) {
  return tipo === "email" ? valor.trim().toLowerCase() : valor.trim();
}

async function obtenerRolNombreActor(actor: ActorUsuario): Promise<string> {
  const rol = await repo.getRolById(actor.rolId);
  if (!rol) throw Errors.forbidden("Tu rol ya no existe");
  return rol.nombre;
}

export async function listarUsuarios() {
  return repo.listUsuarios();
}

export async function listarRoles() {
  return repo.listRoles();
}

export async function crearUsuario(input: CrearUsuarioInput, actor: ActorUsuario) {
  const rolDestino = await repo.getRolById(input.rolId);
  if (!rolDestino) throw Errors.badRequest("Rol no encontrado");

  const rolActor = await obtenerRolNombreActor(actor);
  if (rolActor !== "Super Root" && ROLES_PROTEGIDOS.has(rolDestino.nombre)) {
    throw Errors.forbidden("Solo Super Root puede crear cuentas Root o Super Root");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const valor = normalizarIdentificador(input.tipoIdentificador, input.identificador);
  try {
    return await repo.crearUsuario({
      nombre: input.nombre,
      email: input.tipoIdentificador === "email" ? valor : null,
      numeroDocumento: input.tipoIdentificador === "documento" ? valor : null,
      passwordHash,
      rolId: input.rolId,
    });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23505") {
      throw Errors.conflict("Ya existe un usuario con ese correo o número de documento");
    }
    throw err;
  }
}

export async function editarUsuario(id: string, input: EditarUsuarioInput, actor: ActorUsuario) {
  const objetivo = await repo.getUsuarioById(id);
  if (!objetivo) throw Errors.notFound("Usuario no encontrado");

  const esUnoMismo = objetivo.id === actor.usuarioId;
  if (esUnoMismo && input.activo === false) {
    throw Errors.forbidden("No puedes desactivar tu propia cuenta");
  }

  const rolActor = await obtenerRolNombreActor(actor);
  if (rolActor !== "Super Root") {
    if (ROLES_PROTEGIDOS.has(objetivo.rol_nombre)) {
      throw Errors.forbidden("Solo Super Root puede editar cuentas Root o Super Root");
    }
    if (input.rolId !== undefined) {
      const rolNuevo = await repo.getRolById(input.rolId);
      if (!rolNuevo) throw Errors.badRequest("Rol no encontrado");
      if (ROLES_PROTEGIDOS.has(rolNuevo.nombre)) {
        throw Errors.forbidden("Solo Super Root puede asignar el rol Root o Super Root");
      }
    }
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, SALT_ROUNDS) : undefined;
  const identificador =
    input.tipoIdentificador && input.identificador
      ? { tipo: input.tipoIdentificador, valor: normalizarIdentificador(input.tipoIdentificador, input.identificador) }
      : undefined;
  try {
    const actualizado = await repo.actualizarUsuario(id, {
      nombre: input.nombre,
      passwordHash,
      rolId: input.rolId,
      activo: input.activo,
      identificador,
    });
    if (!actualizado) throw Errors.notFound("Usuario no encontrado");
    return actualizado;
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23505") {
      throw Errors.conflict("Ya existe un usuario con ese correo o número de documento");
    }
    throw err;
  }
}

/**
 * Intenta borrar al usuario físicamente; si tiene actividad registrada en
 * cualquier otra tabla (órdenes, ventas, caja, pedidos...), las FK sin
 * ON DELETE CASCADE rechazan ese DELETE (23503) — en ese caso, en vez de
 * fallar, se cae a un borrado suave (deleted_at + activo=false): el usuario
 * sigue vinculado en todo su historial tal cual estaba, solo queda marcado
 * como eliminado.
 */
export async function eliminarUsuario(id: string, actor: ActorUsuario): Promise<{ tipo: "fisico" | "suave" }> {
  const objetivo = await repo.getUsuarioById(id);
  if (!objetivo) throw Errors.notFound("Usuario no encontrado");

  if (objetivo.id === actor.usuarioId) {
    throw Errors.forbidden("No puedes eliminar tu propia cuenta");
  }

  const rolActor = await obtenerRolNombreActor(actor);
  if (rolActor !== "Super Root" && ROLES_PROTEGIDOS.has(objetivo.rol_nombre)) {
    throw Errors.forbidden("Solo Super Root puede eliminar cuentas Root o Super Root");
  }

  if (objetivo.deleted_at) return { tipo: "suave" }; // ya estaba eliminado — idempotente

  try {
    const borrado = await repo.eliminarUsuario(id);
    if (!borrado) throw Errors.notFound("Usuario no encontrado");
    return { tipo: "fisico" };
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "23503") {
      const marcado = await repo.eliminarUsuarioSuave(id);
      if (!marcado) throw Errors.notFound("Usuario no encontrado");
      return { tipo: "suave" };
    }
    throw err;
  }
}
