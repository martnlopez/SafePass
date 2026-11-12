import { pino } from "pino"
import { createApp } from "../../src/app.js"
import { loadConfig } from "../../src/config/env.js"
import { buildContainer } from "../../src/container.js"
import type { AppDataRepository } from "../../src/repositories/app-data.repository.js"

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    CORS_ORIGINS: "http://localhost:5173",
    SUPABASE_URL: "https://proyecto-de-prueba.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_clave_de_prueba",
    RATE_LIMIT_MAX: "10000",
    ...overrides,
  })
}

/** App Express con Supabase reemplazado por un repositorio falso */
export function createTestApp(appData: AppDataRepository, overrides: Record<string, string> = {}) {
  const config = testConfig(overrides)
  const container = buildContainer({ config, logger: pino({ level: "silent" }), appData })
  return { app: createApp(container), config }
}
