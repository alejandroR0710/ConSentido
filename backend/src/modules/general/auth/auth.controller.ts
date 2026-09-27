import { Request, Response } from "express";
import { ok } from "../../../shared/utils/response";
import { loginSchema } from "./auth.schema";
import * as authService from "./auth.service";

const REFRESH_COOKIE = "refresh_token";
const isProd = process.env.NODE_ENV === "production";

function setRefreshCookie(res: Response, token: string, sessionExpiresAt: number) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // En el hosting (rama hosting-mysql) el mismo proceso sirve la página y la
    // API en un solo dominio, así que la cookie ya no es "cross-site" y
    // "strict" alcanza. secure:true en producción exige HTTPS (AutoSSL de cPanel).
    secure: isProd,
    sameSite: "strict",
    maxAge: Math.max(sessionExpiresAt - Date.now(), 0),
    path: "/api/v1/auth",
  });
}

export async function loginController(req: Request, res: Response) {
  const { identificador, password } = loginSchema.parse(req.body);
  const { accessToken, refreshToken, usuario, sessionExpiresAt } = await authService.login(identificador, password);
  setRefreshCookie(res, refreshToken, sessionExpiresAt);
  return ok(res, { accessToken, usuario });
}

export async function refreshController(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    return res.status(401).json({ data: null, error: { code: "UNAUTHORIZED", message: "Falta refresh token" } });
  }
  const { accessToken, refreshToken, sessionExpiresAt } = await authService.refresh(token);
  setRefreshCookie(res, refreshToken, sessionExpiresAt);
  return ok(res, { accessToken });
}

export async function logoutController(_req: Request, res: Response) {
  // clearCookie debe repetir sameSite/secure exactos de cuando se creó: un
  // navegador no deja que un Set-Cookie sin Secure sobreescriba una cookie que
  // ya tenía Secure, así que sin esto el "borrado" no hacía nada en producción
  // y la sesión volvía sola al recargar la página después de "Salir".
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth", secure: isProd, sameSite: "strict" });
  return ok(res, { success: true });
}

export async function meController(req: Request, res: Response) {
  const usuario = await authService.me(req.auth!.usuarioId);
  return ok(res, usuario);
}
