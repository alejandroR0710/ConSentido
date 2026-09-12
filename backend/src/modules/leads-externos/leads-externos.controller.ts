import { Request, Response } from "express";
import { ok } from "../../shared/utils/response";
import { enviarLeadSchema } from "./leads-externos.schema";
import * as service from "./leads-externos.service";

export async function enviarLeadController(req: Request, res: Response) {
  const data = enviarLeadSchema.parse(req.body);
  return ok(res, await service.enviarLead(data));
}
