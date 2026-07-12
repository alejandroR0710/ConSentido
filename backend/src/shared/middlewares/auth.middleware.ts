import { NextFunction, Request, Response } from "express";
import { Errors } from "../utils/app-error";
import { AccessTokenPayload, verifyAccessToken } from "../utils/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenPayload;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw Errors.unauthorized("Falta el token de acceso");
  }

  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    throw Errors.unauthorized("Token de acceso inválido o expirado");
  }
}
