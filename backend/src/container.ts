import type { AppConfig } from "./config/env.js"
import { AppController } from "./controllers/app.controller.js"
import { HealthController } from "./controllers/health.controller.js"
import type { Logger } from "./lib/logger.js"
import { createRateLimiters } from "./middlewares/rate-limiters.js"
import { SupabaseAppDataRepository, type AppDataRepository } from "./repositories/app-data.repository.js"
import { AppService } from "./services/app.service.js"
import { HealthService } from "./services/health.service.js"

/** Repositorio de datos de la app: Supabase con el token de cada usuario */
export function createAppDataRepository(config: AppConfig): AppDataRepository {
  return new SupabaseAppDataRepository(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, config.SUPABASE_TIMEOUT_MS)
}

/**
 * Composición manual de dependencias: Repository → Service → Controller.
 * Los tests inyectan un repositorio falso en lugar de Supabase.
 */
export function buildContainer(deps: { config: AppConfig; logger: Logger; appData: AppDataRepository }) {
  const { config, logger, appData } = deps
  const app = new AppService(appData)

  return {
    config,
    logger,
    services: { app },
    controllers: {
      app: new AppController(app),
      health: new HealthController(new HealthService(appData)),
    },
    limiters: createRateLimiters(config),
  }
}

export type Container = ReturnType<typeof buildContainer>
