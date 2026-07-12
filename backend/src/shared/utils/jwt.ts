import jwt, { SignOptions } from "jsonwebtoken";

export interface AccessTokenPayload {
  usuarioId: string;
  rolId: number;
  modulos: string[]; // slugs de módulos permitidos
}

export interface RefreshTokenPayload {
  usuarioId: string;
  loginAt: number; // epoch ms del login original
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "";
const ACCESS_TTL = (process.env.ACCESS_TOKEN_TTL ?? "15m") as SignOptions["expiresIn"];
const REFRESH_TTL_HOURS = Number(process.env.REFRESH_TOKEN_TTL_HOURS ?? "10");

/** Duración total de la sesión: se cuenta desde el login original, no se reinicia al refrescar. */
export const SESSION_TTL_MS = REFRESH_TTL_HOURS * 60 * 60 * 1000;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * El refresh token expira en loginAt + SESSION_TTL_MS, sin importar cuántas veces
 * se reemita: refrescar la sesión NO extiende la ventana de 10 horas del login.
 */
export function signRefreshToken(usuarioId: string, loginAt: number): string {
  const remainingSeconds = Math.max(Math.floor((loginAt + SESSION_TTL_MS - Date.now()) / 1000), 1);
  const payload: RefreshTokenPayload = { usuarioId, loginAt };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: remainingSeconds });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
}
