import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"
import { AppError, RecordNotFoundError, UniqueConstraintError } from "../errors/app-error.js"
import type { Logger } from "../lib/logger.js"

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: unknown }
}

/** 404 para rutas inexistentes */
export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: "Recurso no encontrado", requestId: req.id } })
}

/**
 * Traduce cualquier error a una respuesta JSON uniforme.
 * Los errores no controlados devuelven 500 sin detalles internos (el detalle queda en el log).
 */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const send = (status: number, body: ErrorBody["error"], headers?: Record<string, string>) => {
      if (headers) res.set(headers)
      res.status(status).json({ error: { ...body, requestId: req.id } } satisfies ErrorBody)
    }

    if (err instanceof AppError) {
      return send(err.status, { code: err.code, message: err.message, details: err.details }, err.headers)
    }
    if (err instanceof ZodError) {
      return send(400, {
        code: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      })
    }
    if (err instanceof UniqueConstraintError) {
      return send(409, { code: "DUPLICATE", message: "El recurso ya existe" })
    }
    if (err instanceof RecordNotFoundError) {
      return send(404, { code: "NOT_FOUND", message: "Recurso no encontrado" })
    }

    // Errores de body-parser (JSON mal formado, cuerpo demasiado grande)
    const type = (err as { type?: string } | null)?.type
    if (type === "entity.parse.failed") return send(400, { code: "MALFORMED_JSON", message: "JSON mal formado" })
    if (type === "entity.too.large") return send(413, { code: "PAYLOAD_TOO_LARGE", message: "El cuerpo es demasiado grande" })

    logger.error({ err, requestId: req.id, method: req.method, url: req.originalUrl }, "Error no controlado")
    return send(500, { code: "INTERNAL_ERROR", message: "Error interno del servidor" })
  }
}
