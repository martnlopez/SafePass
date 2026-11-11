import type { AppConfig } from "./config/env.js"
import { AppController } from "./controllers/app.controller.js"
import { AuthController } from "./controllers/auth.controller.js"
import { SupabaseAppDataRepository, type AppDataRepository } from "./repositories/app-data.repository.js"
import { AppService } from "./services/app.service.js"
import { EvaluationController } from "./controllers/evaluation.controller.js"
import { HealthController } from "./controllers/health.controller.js"
import { WorkerController } from "./controllers/worker.controller.js"
import { FieldCipher } from "./lib/crypto.js"
import type { Logger } from "./lib/logger.js"
import { PinHasher } from "./lib/pin.js"
import type { PrismaClient } from "./lib/prisma.js"
import { TokenService } from "./lib/tokens.js"
import { createRateLimiters } from "./middlewares/rate-limiters.js"
import { PrismaAuditLogRepository, type AuditLogRepository } from "./repositories/audit-log.repository.js"
import { PrismaEvaluationRepository, type EvaluationRepository } from "./repositories/evaluation.repository.js"
import { PrismaHealthRepository, type HealthRepository } from "./repositories/health.repository.js"
import { PrismaTotemRepository, type TotemRepository } from "./repositories/totem.repository.js"
import { PrismaWorkerRepository, type WorkerRepository } from "./repositories/worker.repository.js"
import { AuditService } from "./services/audit.service.js"
import { AuthService } from "./services/auth.service.js"
import { EvaluationService } from "./services/evaluation.service.js"
import { HealthService } from "./services/health.service.js"
import { WorkerService } from "./services/worker.service.js"

export interface Repositories {
  workers: WorkerRepository
  evaluations: EvaluationRepository
  totems: TotemRepository
  auditLogs: AuditLogRepository
  health: HealthRepository
}

export function createPrismaRepositories(db: PrismaClient): Repositories {
  return {
    workers: new PrismaWorkerRepository(db),
    evaluations: new PrismaEvaluationRepository(db),
    totems: new PrismaTotemRepository(db),
    auditLogs: new PrismaAuditLogRepository(db),
    health: new PrismaHealthRepository(db),
  }
}

/** Repositorio de la app en Supabase si el servidor está configurado para ello */
export function createAppDataRepository(config: AppConfig): AppDataRepository | null {
  if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return null
  return new SupabaseAppDataRepository(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, config.SUPABASE_TIMEOUT_MS)
}

/**
 * Composición manual de dependencias: Repositories → Services → Controllers.
 * Los tests inyectan repositorios en memoria y un reloj controlado.
 */
export function buildContainer(deps: {
  config: AppConfig
  logger: Logger
  repositories: Repositories
  /** Datos de la app en Supabase (null si el servidor no tiene SUPABASE_* configurado) */
  appData?: AppDataRepository | null
  now?: () => Date
}) {
  const { config, logger, repositories: repos } = deps
  const now = deps.now ?? (() => new Date())

  const cipher = new FieldCipher(config.FIELD_ENCRYPTION_KEY, config.BLIND_INDEX_KEY)
  const pins = new PinHasher(config.PIN_PEPPER)
  const tokens = new TokenService({
    secret: config.JWT_SECRET,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    staffTtlSeconds: config.JWT_STAFF_TTL_SECONDS,
    totemSessionTtlSeconds: config.JWT_TOTEM_SESSION_TTL_SECONDS,
  })

  const audit = new AuditService(repos.auditLogs, logger)
  const evaluation = new EvaluationService(
    repos.evaluations,
    repos.workers,
    cipher,
    audit,
    { retestCooldownMinutes: config.RETEST_COOLDOWN_MINUTES },
    now,
  )
  const auth = new AuthService(
    repos.workers,
    repos.totems,
    tokens,
    pins,
    audit,
    evaluation,
    { maxLoginAttempts: config.LOGIN_MAX_ATTEMPTS, lockoutMinutes: config.LOGIN_LOCKOUT_MINUTES },
    now,
  )
  const worker = new WorkerService(repos.workers, cipher, pins, audit, now)
  const health = new HealthService(repos.health)
  const app = deps.appData ? new AppService(deps.appData) : null

  return {
    config,
    logger,
    services: { auth, worker, evaluation, health, audit, app },
    controllers: {
      auth: new AuthController(auth),
      worker: new WorkerController(worker),
      evaluation: new EvaluationController(evaluation),
      health: new HealthController(health),
      app: app ? new AppController(app) : null,
    },
    limiters: createRateLimiters(config),
  }
}

export type Container = ReturnType<typeof buildContainer>
