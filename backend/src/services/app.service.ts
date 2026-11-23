import { AppError, DataRuleError, Errors, UpstreamUnavailableError } from "../errors/app-error.js"
import type { AppDataRepository } from "../repositories/app-data.repository.js"
import type { AppDecisionType, AppUser, BatteryEntry } from "../types/app.js"

/**
 * Significado HTTP de cada regla que aplica la base de Supabase (prompt §3.5 y §6.10).
 * Las reglas NO se reimplementan aquí: la base decide y este servicio solo traduce.
 */
const RULES: Record<string, () => AppError> = {
  NOT_AUTHENTICATED: () => Errors.unauthorized("Sesión no válida", "NOT_AUTHENTICATED"),
  ACCOUNT_DISABLED: () => Errors.forbidden("Tu cuenta no está habilitada", "ACCOUNT_DISABLED"),
  NOT_ALLOWED: () => Errors.forbidden("No tienes permisos para esta acción", "NOT_ALLOWED"),
  SELF_DECISION_NOT_ALLOWED: () => Errors.forbidden("Otro supervisor debe decidir sobre tu evaluación", "SELF_DECISION_NOT_ALLOWED"),
  SUPERVISOR_AUTHORIZATION_REQUIRED: () =>
    Errors.forbidden("Tu último resultado requiere una indicación de tu supervisor", "SUPERVISOR_AUTHORIZATION_REQUIRED"),
  EVALUATION_TOO_SOON: () => Errors.tooManyRequests("Ya registraste una evaluación hace menos de 2 minutos", 120, "EVALUATION_TOO_SOON"),
  RETEST_COOLDOWN: () => Errors.tooManyRequests("Debes completar el descanso preventivo de 5 minutos", 300, "RETEST_COOLDOWN"),
  RETEST_REST_PENDING: () => Errors.tooManyRequests("El descanso indicado por tu supervisor aún no termina", 60, "RETEST_REST_PENDING"),
  TOO_MANY_SESSIONS: () => Errors.tooManyRequests("Demasiados intentos de evaluación en la última hora", 3600, "TOO_MANY_SESSIONS"),
  EVALUATION_TOO_FAST: () => new AppError(422, "EVALUATION_TOO_FAST", "La evaluación terminó demasiado rápido para ser válida"),
  EVALUATION_SESSION_EXPIRED: () => new AppError(422, "EVALUATION_SESSION_EXPIRED", "La sesión de evaluación venció"),
  EVALUATION_SESSION_REQUIRED: () => new AppError(422, "EVALUATION_SESSION_REQUIRED", "Falta la sesión de evaluación"),
  INVALID_BREAKDOWN: () => new AppError(422, "INVALID_BREAKDOWN", "El resultado de la evaluación llegó incompleto"),
  PASS_NOT_ALLOWED: () => new AppError(422, "PASS_NOT_ALLOWED", "No hay un resultado APTO vigente ni un pase autorizado"),
  EVALUATION_SESSION_INVALID: () => new AppError(404, "EVALUATION_SESSION_INVALID", "La sesión de evaluación no existe o no es tuya"),
  DECISION_NOT_FOUND: () => new AppError(404, "DECISION_NOT_FOUND", "La decisión ya no está disponible"),
}

export class AppService {
  constructor(private readonly data: AppDataRepository) {}

  /** Traduce errores del nivel de datos; lo desconocido sigue como 500 sobrio */
  private async call<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (err) {
      if (err instanceof DataRuleError) {
        const mapped = RULES[err.code]
        if (mapped) return Promise.reject(mapped())
      }
      if (err instanceof UpstreamUnavailableError) {
        return Promise.reject(
          new AppError(503, "UPSTREAM_UNAVAILABLE", "El servicio de datos no responde. Inténtalo de nuevo.", undefined, {
            "Retry-After": "5",
          }),
        )
      }
      throw err
    }
  }

  /** Identifica al usuario por su token de Supabase Auth (401 si no es válido) */
  async authenticate(token: string): Promise<AppUser> {
    const id = await this.call(() => this.data.verifyAccessToken(token))
    if (!id) throw Errors.unauthorized("Sesión no válida o vencida", "INVALID_SESSION")
    return { id, token }
  }

  async profile(user: AppUser) {
    const profile = await this.call(() => this.data.profile(user.token, user.id))
    // Cuenta inexistente o desactivada: 403 sin más detalle
    if (!profile) throw Errors.forbidden("Tu cuenta no está habilitada", "ACCOUNT_DISABLED")
    return profile
  }

  evaluations(user: AppUser) {
    return this.call(() => this.data.evaluations(user.token, user.id))
  }

  latestEvaluation(user: AppUser) {
    return this.call(() => this.data.latestEvaluation(user.token, user.id))
  }

  latestDecision(user: AppUser) {
    return this.call(() => this.data.latestDecision(user.token, user.id))
  }

  async currentPass(user: AppUser) {
    const profile = await this.profile(user)
    return this.call(() => this.data.currentPass(user.token, user.id, profile.fichaId))
  }

  startEvaluation(user: AppUser) {
    return this.call(() => this.data.startEvaluation(user.token))
  }

  /** Idempotente por sesión: el reintento devuelve la misma evaluación con replayed = true */
  submitEvaluation(user: AppUser, sessionId: string, breakdown: BatteryEntry[], durationSeconds: number | null) {
    return this.call(() => this.data.submitEvaluation(user.token, sessionId, breakdown, durationSeconds))
  }

  issuePass(user: AppUser) {
    return this.call(() => this.data.issuePass(user.token))
  }

  validatePass(user: AppUser, code: string) {
    return this.call(() => this.data.validatePass(user.token, code))
  }

  createDecision(user: AppUser, input: { workerId: string; decision: AppDecisionType; note?: string | null | undefined }) {
    const note = input.note?.trim() ? input.note.trim() : null
    return this.call(() => this.data.createDecision(user.token, { workerId: input.workerId, decision: input.decision, note }))
  }

  markDecisionSeen(user: AppUser, decisionId: string) {
    return this.call(() => this.data.markDecisionSeen(user.token, decisionId))
  }

  startAuthorizedRetest(user: AppUser, decisionId: string) {
    return this.call(() => this.data.startAuthorizedRetest(user.token, decisionId))
  }
}
