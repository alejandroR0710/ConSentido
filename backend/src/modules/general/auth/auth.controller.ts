import { Request, Response } from "express";
import { ok } from "../../../shared/utils/response";
import { loginSchema } from "./auth.schema";
import * as authService from "./auth.service";

const REFRESH_COOKIE = "refresh_token";
const isProd = process.env.NODE_ENV === "production";

function setRefreshCookie(res: Response, token: string, sessionExpiresAt: number) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // En producción el frontend (Vercel) y el backend (Render) viven en dominios
    // distintos, así que la cookie es "cross-site": el navegador solo la manda si
    // sameSite es "none", y "none" exige secure:true (solo funciona sobre HTTPS,
    // que ambos proveen). En local, frontend y backend comparten origen de
    // desarrollo así que "strict" es más seguro y no hace falta relajarlo.
    secure: isProd,
    sameSite: isProd ? "none" : "strict",
    maxAge: Math.max(sessionExpiresAt - Date.now(), 0),
    path: "/api/v1/auth",
  });
}

export async function loginController(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const { accessToken, refreshToken, usuario, sessionExpiresAt } = await authService.login(email, password);
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
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  return ok(res, { success: true });
}

export async function meController(req: Request, res: Response) {
  const usuario = await authService.me(req.auth!.usuarioId);
  return ok(res, usuario);
}
