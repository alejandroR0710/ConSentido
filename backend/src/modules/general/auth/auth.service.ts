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
 * Renueva el access token y DESLIZA la ventana de la sesión hacia adelante
 * (el nuevo refresh token cuenta desde ahora, no desde el login original) —
 * mientras el dispositivo se use al menos una vez dentro de SESSION_TTL_MS,
 * la sesión no se cierra sola. El chequeo de abajo solo dispara si el
 * refresh token mismo ya venció (dispositivo abandonado más de esa
 * ventana) — jwt.verify ya lo habría rechazado por su propio `exp`, esto es
 * nada más un mensaje más claro que el genérico de verifyRefreshToken.
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
  const loginAt = Date.now();

  return {
    accessToken: signAccessToken({ usuarioId: usuario.id, rolId: usuario.rolId, modulos }),
    refreshToken: signRefreshToken(usuario.id, loginAt),
    sessionExpiresAt: loginAt + SESSION_TTL_MS,
  };
}
