import { Router } from "express";
import { authMiddleware } from "../../../shared/middlewares/auth.middleware";
import { asyncHandler } from "../../../shared/utils/async-handler";
import { loginController, logoutController, meController, refreshController } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(loginController));
authRouter.post("/refresh", asyncHandler(refreshController));
authRouter.post("/logout", asyncHandler(logoutController));
authRouter.get("/me", authMiddleware, asyncHandler(meController));
