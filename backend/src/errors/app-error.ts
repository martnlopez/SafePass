/** Error de dominio con código HTTP semántico. El errorHandler lo traduce a JSON. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "No autenticado", code = "UNAUTHORIZED") => new AppError(401, code, message),
  forbidden: (message = "No tienes permisos para esta acción", code = "FORBIDDEN") => new AppError(403, code, message),
  notFound: (resource: string) => new AppError(404, "NOT_FOUND", `${resource} no encontrado`),
  conflict: (message: string, code = "CONFLICT") => new AppError(409, code, message),
  tooManyRequests: (message: string, retryAfterSeconds: number, code = "TOO_MANY_REQUESTS") =>
    new AppError(429, code, message, { retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) }),
}

/** Lanzado por repositorios ante una restricción UNIQUE (independiente de Prisma) */
export class UniqueConstraintError extends Error {
  constructor(readonly fields: string[] = []) {
    super(`Valor duplicado${fields.length ? ` en: ${fields.join(", ")}` : ""}`)
    this.name = "UniqueConstraintError"
  }
}

/** Lanzado por repositorios cuando el registro a modificar no existe */
export class RecordNotFoundError extends Error {
  constructor() {
    super("Registro no encontrado")
    this.name = "RecordNotFoundError"
  }
}
