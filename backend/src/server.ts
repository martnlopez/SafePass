import { createApp } from "./app.js"
import { loadConfig, type AppConfig } from "./config/env.js"
import { buildContainer, createAppDataRepository, createPrismaRepositories } from "./container.js"
import { createLogger } from "./lib/logger.js"
import { createPrismaClient } from "./lib/prisma.js"

let config: AppConfig
try {
  config = loadConfig()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development")
const prisma = createPrismaClient(config.DATABASE_URL)
const appData = createAppDataRepository(config)
if (!appData) logger.warn("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY sin configurar: la API de la app (/api/v1/app) responde 503")
const container = buildContainer({ config, logger, repositories: createPrismaRepositories(prisma), appData })
const app = createApp(container)

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, `SafePass API escuchando en http://localhost:${config.PORT}`)
})

// Apagado ordenado: deja de aceptar conexiones, termina las en curso y cierra el pool de BD
let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "Cerrando servidor…")
  const timer = setTimeout(() => {
    logger.error("Cierre forzado tras 10 s")
    process.exit(1)
  }, 10_000)
  timer.unref()
  server.close(async () => {
    await prisma.$disconnect()
    logger.info("Servidor detenido")
    process.exit(0)
  })
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("unhandledRejection", (reason) => logger.error({ err: reason }, "Promesa rechazada sin manejar"))
