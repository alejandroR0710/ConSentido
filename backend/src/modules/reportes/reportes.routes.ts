import { Router } from "express";
import { authMiddleware } from "../../shared/middlewares/auth.middleware";

export const reportesRouter = Router();
reportesRouter.use(authMiddleware);
