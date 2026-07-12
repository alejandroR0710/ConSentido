export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthorized: (message = "No autenticado") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "No tiene permiso para esta acción") => new AppError(403, "FORBIDDEN", message),
  notFound: (message = "Recurso no encontrado") => new AppError(404, "NOT_FOUND", message),
  badRequest: (message = "Solicitud inválida") => new AppError(400, "BAD_REQUEST", message),
  conflict: (message = "Conflicto con el estado actual") => new AppError(409, "CONFLICT", message),
};
