import bcrypt from "bcryptjs";
import { Errors } from "../../../shared/utils/app-error";
import { SESSION_TTL_MS, signAccessToken, signRefreshToken, verifyRefreshToken } from "../../../shared/utils/jwt";
import {
  findModulosPermitidos,
  findUsuarioByIdentificador,
  findUsuarioById,
  updateUltimoLogin,
} from "./auth.repository";

export async function login(identificador: string, password: string) {
  const usuario = await findUsuarioByIdentificador(identificador);
  if (!usuario || !usuario.activo) {
    throw Errors.unauthorized("Credenciales inválidas");
  }

  const passwordValida = await bcrypt.compare(password, usuario.passwordHash);
  if (!passwordValida) {
    throw Errors.unauthorized("Credenciales inválidas");
  }

  const modulos = await findModulosPermitidos(usuario.id, usuario.rolId);
  await updateUltimoLogin(usuario.id);

  const loginAt = Date.now();
  return {
    accessToken: signAccessToken({ usuarioId: usuario.id, rolId: usuario.rolId, modulos }),
    refreshToken: signRefreshToken(usuario.id, loginAt),
    sessionExpiresAt: loginAt + SESSION_TTL_MS,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      numeroDocumento: usuario.numeroDocumento,
      rolId: usuario.rolId,
      rol: usuario.rolNombre,
      modulos,
    },
  };
}

export async function me(usuarioId: string) {
  const usuario = await findUsuarioById(usuarioId);
  if (!usuario || !usuario.activo) {
    throw Errors.unauthorized("Usuario inválido");
  }
  const modulos = await findModulosPermitidos(usuario.id, usuario.rolId);
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    numeroDocumento: usuario.numeroDocumento,
    rolId: usuario.rolId,
    rol: usuario.rolNombre,
    modulos,
  };
}

/**
 * Renueva el access token sin extender la sesión más allá de las 10 horas del login
 * original: loginAt viaja dentro del refresh token y se preserva en cada reemisión.
 */
export async function refresh(refreshToken: string) {
  let payload: { usuarioId: string; loginAt: number };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Errors.unauthorized("Refresh token inválido o expirado");
  }

  if (Date.now() >= payload.loginAt + SESSION_TTL_MS) {
    throw Errors.unauthorized("La sesión expiró, inicia sesión nuevamente");
  }

  const usuario = await findUsuarioById(payload.usuarioId);
  if (!usuario || !usuario.activo) {
    throw Errors.unauthorized("Usuario inválido");
  }

  const modulos = await findModulosPermitidos(usuario.id, usuario.rolId);

  return {
    accessToken: signAccessToken({ usuarioId: usuario.id, rolId: usuario.rolId, modulos }),
    refreshToken: signRefreshToken(usuario.id, payload.loginAt),
    sessionExpiresAt: payload.loginAt + SESSION_TTL_MS,
  };
}
