import { Request, Response } from "express";
import { created, ok } from "../../../shared/utils/response";
import { crearUsuarioSchema, editarUsuarioSchema } from "./usuarios.schema";
import * as service from "./usuarios.service";

function actorDe(req: Request) {
  return { usuarioId: req.auth!.usuarioId, rolId: req.auth!.rolId };
}

export async function listarUsuariosController(_req: Request, res: Response) {
  const usuarios = await service.listarUsuarios();
  return ok(res, usuarios);
}

export async function listarRolesController(_req: Request, res: Response) {
  const roles = await service.listarRoles();
  return ok(res, roles);
}

export async function crearUsuarioController(req: Request, res: Response) {
  const data = crearUsuarioSchema.parse(req.body);
  const usuario = await service.crearUsuario(data, actorDe(req));
  return created(res, usuario);
}

export async function editarUsuarioController(req: Request, res: Response) {
  const data = editarUsuarioSchema.parse(req.body);
  const usuario = await service.editarUsuario(req.params.id, data, actorDe(req));
  return ok(res, usuario);
}

export async function eliminarUsuarioController(req: Request, res: Response) {
  await service.eliminarUsuario(req.params.id, actorDe(req));
  return ok(res, { eliminado: true });
}
