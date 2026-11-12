import type { Request, Response } from "express"
import { rateLimit, type Options } from "express-rate-limit"
import type { AppConfig } from "../config/env.js"

/**
 * Límites de tasa (anti scraping y anti abuso).
 * Store en memoria: suficiente para una instancia. Con varias réplicas, usar un
 * store compartido (p. ej. rate-limit-redis) para que el conteo sea global.
 * Las reglas finas (descansos, sesiones por hora, un envío por sesión) las aplica la base.
 */
function limiter(overrides: Partial<Options>) {
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req: Request, res: Response, _next, options) => {
      const retryAfter = Number(res.getHeader("Retry-After")) || Math.ceil(options.windowMs / 1000)
      res.status(options.statusCode).json({
        error: {
          code: "RATE_LIMITED",
          message: "Demasiadas solicitudes. Intenta nuevamente más tarde.",
          details: { retryAfterSeconds: retryAfter },
          requestId: req.id,
        },
      })
    },
    ...overrides,
  })
}

export function createRateLimiters(config: AppConfig) {
  const windowMs = config.RATE_LIMIT_WINDOW_MINUTES * 60_000
  return {
    /** Límite general por IP para toda la API */
    api: limiter({ windowMs, limit: config.RATE_LIMIT_MAX }),
  }
}

export type RateLimiters = ReturnType<typeof createRateLimiters>
