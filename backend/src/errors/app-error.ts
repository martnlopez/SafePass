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

/**
 * Regla de negocio rechazada por la base de Supabase: un trigger o una RPC lanzó un código
 * en MAYÚSCULAS (p. ej. "PASS_NOT_ALLOWED"). Nace en el repository; el service le da el
 * significado HTTP (prompt de arquitectura §6.10).
 */
export class DataRuleError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "DataRuleError"
  }
}

/** Supabase no respondió (timeout, sin red). Reintentar más tarde tiene sentido. */
export class UpstreamUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Servicio de datos no disponible", { cause })
    this.name = "UpstreamUnavailableError"
  }
}
