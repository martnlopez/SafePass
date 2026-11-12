import { randomUUID } from "node:crypto"
import cors from "cors"
import express, { type Express } from "express"
import helmet from "helmet"
import { pinoHttp } from "pino-http"
import type { Container } from "./container.js"
import { errorHandler, notFound } from "./middlewares/error-handler.js"
import { createApiRouter, createHealthRouter } from "./routes/index.js"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createApp(container: Container): Express {
  const { config, logger } = container
  const app = express()

  // Detrás de un proxy/balanceador: número de saltos confiables (necesario para req.ip y rate limit)
  app.set("trust proxy", config.TRUST_PROXY)
  app.disable("x-powered-by")

  // Cabeceras de seguridad (CSP, HSTS, noSniff, frameguard, etc.)
  app.use(helmet())

  // CORS restringido a los orígenes de CORS_ORIGINS. Sin header Origin (curl, servidor a servidor) no aplica CORS.
  const allowed = new Set(config.CORS_ORIGINS)
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
      methods: ["GET", "POST", "PATCH"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Retry-After", "RateLimit", "RateLimit-Policy", "Location"],
      maxAge: 600,
    }),
  )

  // Log de peticiones con id de correlación (X-Request-Id)
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"]
        const id = typeof incoming === "string" && UUID.test(incoming) ? incoming : randomUUID()
        res.setHeader("X-Request-Id", id)
        return id
      },
      autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  )

  app.use(express.json({ limit: config.JSON_BODY_LIMIT }))

  app.use("/health", createHealthRouter(container))

  // Datos sensibles: nunca en caché de navegador ni proxies
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store")
    next()
  })
  app.use("/api", container.limiters.api)
  app.use("/api/v1", createApiRouter(container))

  app.use(notFound)
  app.use(errorHandler(logger))
  return app
}
