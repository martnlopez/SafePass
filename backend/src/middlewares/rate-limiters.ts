import type { Request, Response } from "express"
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit"
import type { AppConfig } from "../config/env.js"

/**
 * Límites de tasa (anti fuerza bruta y anti scraping).
 * Store en memoria: suficiente para una instancia. Con varias réplicas, usar un
 * store compartido (p. ej. rate-limit-redis) para que el conteo sea global.
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

    /** Login y apertura de sesión en tótem: solo cuentan los intentos fallidos */
    login: limiter({ windowMs, limit: config.RATE_LIMIT_LOGIN_MAX, skipSuccessfulRequests: true }),

    /**
     * Fallos por (IP, ficha): una misma IP no puede adivinar el PIN de una cuenta ni
     * mantenerla bloqueada. El bloqueo de la cuenta (umbral más alto) queda para la
     * fuerza bruta distribuida entre muchas IP.
     */
    loginPerAccount: limiter({
      windowMs,
      limit: config.RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX,
      skipSuccessfulRequests: true,
      keyGenerator: (req: Request) => {
        const body = req.body as { fichaId?: unknown } | undefined
        const ficha = typeof body?.fichaId === "string" ? body.fichaId.trim().toUpperCase().slice(0, 16) : "-"
        return `${ipKeyGenerator(req.ip ?? "unknown")}:${ficha}`
      },
    }),

    /** Envío de evaluaciones: por tótem (si hay sesión) o por IP */
    evaluationSubmit: limiter({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_EVALUATIONS_PER_MINUTE,
      keyGenerator: (req: Request) =>
        req.auth?.kind === "totem" ? `totem:${req.auth.totemId}` : ipKeyGenerator(req.ip ?? "unknown"),
    }),
  }
}

export type RateLimiters = ReturnType<typeof createRateLimiters>
