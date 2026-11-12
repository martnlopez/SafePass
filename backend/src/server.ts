import { createApp } from "./app.js"
import { loadConfig, type AppConfig } from "./config/env.js"
import { buildContainer, createAppDataRepository } from "./container.js"
import { createLogger } from "./lib/logger.js"

let config: AppConfig
try {
  config = loadConfig()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development")
const container = buildContainer({ config, logger, appData: createAppDataRepository(config) })
const app = createApp(container)

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `SafePass API escuchando en http://localhost:${config.PORT}`)
})

// Apagado ordenado: deja de aceptar conexiones y termina las que están en curso
let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "Cerrando servidor…")
  const timer = setTimeout(() => {
    logger.error("Cierre forzado tras 10 s")
    process.exit(1)
  }, 10_000)
  timer.unref()
  server.close(() => {
    logger.info("Servidor detenido")
    process.exit(0)
  })
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Promesa rechazada sin manejar"))
