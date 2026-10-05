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
// Antes 10h desde el login original, sin renovarse — un turno largo o el
// celular bloqueado de un día para otro cerraba la sesión sola. Ahora es
// "deslizante" (ver signRefreshToken) y bastante más larga por defecto: en
// la práctica la sesión no se cierra mientras el dispositivo se use al
// menos una vez dentro de esta ventana — ajustable con REFRESH_TOKEN_TTL_HOURS.
const REFRESH_TTL_HOURS = Number(process.env.REFRESH_TOKEN_TTL_HOURS ?? "720"); // 30 días

/** Ventana de inactividad máxima antes de que la sesión expire de verdad. */
export const SESSION_TTL_MS = REFRESH_TTL_HOURS * 60 * 60 * 1000;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * `loginAt` ya no es el login original: cada llamada (login o refresh) lo
 * pasa como "ahora", así la ventana de SESSION_TTL_MS se desliza hacia
 * adelante en cada uso — un dispositivo que se abre al menos una vez dentro
 * de esa ventana nunca llega a expirar. Solo un dispositivo realmente
 * abandonado por más de REFRESH_TTL_HOURS se desloguea solo.
 */
export function signRefreshToken(usuarioId: string, loginAt: number): string {
  const remainingSeconds = Math.max(Math.floor((loginAt + SESSION_TTL_MS - Date.now()) / 1000), 1);
  const payload: RefreshTokenPayload = { usuarioId, loginAt };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: remainingSeconds });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
}
