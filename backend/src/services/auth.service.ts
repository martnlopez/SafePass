import { Errors } from "../errors/app-error.js"
import { safeEqualHex, sha256Hex } from "../lib/crypto.js"
import type { PinHasher } from "../lib/pin.js"
import type { TokenService } from "../lib/tokens.js"
import type { TotemRepository } from "../repositories/totem.repository.js"
import type { WorkerRepository } from "../repositories/worker.repository.js"
import type { LoginDto } from "../schemas/auth.schema.js"
import type { Principal, StaffPrincipal, TotemDevice } from "../types/auth.js"
import type { RequestContext, WorkerRecord } from "../types/domain.js"
import type { AuditService } from "./audit.service.js"

/** Reglas de re-evaluación (las implementa EvaluationService) */
export interface EvaluationEligibility {
  assertCanStartEvaluation(subjectId: string): Promise<void>
}

export interface AuthSettings {
  maxLoginAttempts: number
  lockoutMinutes: number
}

const INVALID_CREDENTIALS = () => Errors.unauthorized("Ficha ID o PIN incorrectos", "INVALID_CREDENTIALS")
const TOTEM_KEY_FORMAT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{20,})$/i

export class AuthService {
  constructor(
    private readonly workers: WorkerRepository,
    private readonly totems: TotemRepository,
    private readonly tokens: TokenService,
    private readonly pins: PinHasher,
    private readonly audit: AuditService,
    private readonly eligibility: EvaluationEligibility,
    private readonly settings: AuthSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Login del panel web: solo SUPERVISOR y ADMIN */
  async loginStaff(dto: LoginDto, ctx: RequestContext) {
    const worker = await this.verifyCredentials(dto, ctx)
    if (worker.role !== "SUPERVISOR" && worker.role !== "ADMIN") {
      throw Errors.forbidden("Tu perfil no tiene acceso al panel de supervisión", "STAFF_ONLY")
    }
    const issued = this.tokens.signStaff(worker.id, worker.role)
    await this.audit.record(
      { actorType: "STAFF", actorId: worker.id, action: "LOGIN_SUCCEEDED", entityType: "Worker", entityId: worker.id },
      ctx,
    )
    return {
      accessToken: issued.token,
      tokenType: "Bearer" as const,
      expiresIn: issued.expiresIn,
      user: { id: worker.id, fichaId: worker.fichaId, fullName: worker.fullName, role: worker.role },
    }
  }

  /**
   * Abre una sesión de evaluación en un tótem autenticado.
   * El token resultante solo contiene el seudónimo del trabajador y sirve para UNA evaluación.
   */
  async startTotemSession(device: TotemDevice, dto: LoginDto, ctx: RequestContext) {
    const worker = await this.verifyCredentials(dto, ctx)
    await this.eligibility.assertCanStartEvaluation(worker.pseudonymId)
    const issued = this.tokens.signTotemSession(worker.pseudonymId, device.id)
    await this.audit.record(
      { actorType: "TOTEM", actorId: device.id, action: "TOTEM_SESSION_STARTED", entityType: "Worker", entityId: worker.id },
      ctx,
    )
    return {
      sessionToken: issued.token,
      tokenType: "Bearer" as const,
      expiresIn: issued.expiresIn,
      fichaId: worker.fichaId,
    }
  }

  /** Valida la clave del dispositivo: "<totemId>.<secreto>" */
  async authenticateTotemDevice(rawKey: string | undefined): Promise<TotemDevice> {
    const match = rawKey ? TOTEM_KEY_FORMAT.exec(rawKey.trim()) : null
    if (!match) throw Errors.unauthorized("Clave de tótem inválida", "INVALID_TOTEM_KEY")
    const [, id = "", secret = ""] = match
    const totem = await this.totems.findById(id.toLowerCase())
    const valid = totem !== null && totem.active && safeEqualHex(sha256Hex(secret), totem.keyHash)
    if (!totem || !valid) throw Errors.unauthorized("Clave de tótem inválida", "INVALID_TOTEM_KEY")
    await this.totems.touch(totem.id, this.now())
    return { id: totem.id, name: totem.name }
  }

  /** Resuelve el JWT y revalida contra la BD (cuenta desactivada o tótem dado de baja ⇒ 401) */
  async resolvePrincipal(token: string): Promise<Principal> {
    const claims = this.tokens.verify(token)
    if (claims.typ === "staff") {
      const worker = await this.workers.findById(claims.sub)
      if (!worker || !worker.active || (worker.role !== "SUPERVISOR" && worker.role !== "ADMIN")) {
        throw Errors.unauthorized("Sesión no válida", "INVALID_SESSION")
      }
      // El rol se toma de la BD: una degradación de permisos aplica de inmediato
      return { kind: "staff", role: worker.role, workerId: worker.id, fichaId: worker.fichaId }
    }
    const totem = await this.totems.findById(claims.tid)
    if (!totem?.active) throw Errors.unauthorized("Sesión no válida", "INVALID_SESSION")
    // Un trabajador desactivado durante la sesión ya no puede registrar la evaluación
    const [subject] = await this.workers.findByPseudonymIds([claims.sub])
    if (!subject?.active) throw Errors.unauthorized("Sesión no válida", "INVALID_SESSION")
    return { kind: "totem", role: "TOTEM", subjectId: claims.sub, totemId: claims.tid, sessionId: claims.jti }
  }

  async me(principal: StaffPrincipal) {
    const worker = await this.workers.findById(principal.workerId)
    if (!worker) throw Errors.unauthorized("Sesión no válida", "INVALID_SESSION")
    return { id: worker.id, fichaId: worker.fichaId, fullName: worker.fullName, role: worker.role }
  }

  /** Ficha + PIN con bloqueo progresivo. Mensaje genérico para no revelar qué dato falló. */
  private async verifyCredentials(dto: LoginDto, ctx: RequestContext): Promise<WorkerRecord> {
    const worker = await this.workers.findByFichaId(dto.fichaId)
    if (!worker) {
      await this.pins.verifyAgainstDummy(dto.pin)
      await this.audit.record(
        { actorType: "ANONYMOUS", actorId: null, action: "LOGIN_FAILED", metadata: { reason: "unknown_ficha" } },
        ctx,
      )
      throw INVALID_CREDENTIALS()
    }

    // Cuenta bloqueada: misma respuesta y mismo costo que un PIN erróneo, para no revelar
    // que la ficha existe ni que está bloqueada (el motivo queda en la auditoría)
    const now = this.now()
    if (worker.lockedUntil && worker.lockedUntil > now) {
      await this.pins.verifyAgainstDummy(dto.pin)
      await this.audit.record(
        { actorType: "ANONYMOUS", actorId: null, action: "LOGIN_FAILED", entityType: "Worker", entityId: worker.id, metadata: { reason: "locked" } },
        ctx,
      )
      throw INVALID_CREDENTIALS()
    }

    if (!(await this.pins.verify(worker.pinHash, dto.pin))) {
      const attempts = await this.workers.incrementFailedLogins(worker.id)
      if (attempts >= this.settings.maxLoginAttempts) {
        const lockSeconds = this.settings.lockoutMinutes * 60
        await this.workers.update(worker.id, {
          failedLoginAttempts: 0,
          lockedUntil: new Date(now.getTime() + lockSeconds * 1000),
        })
        await this.audit.record(
          { actorType: "ANONYMOUS", actorId: null, action: "ACCOUNT_LOCKED", entityType: "Worker", entityId: worker.id },
          ctx,
        )
        throw INVALID_CREDENTIALS()
      }
      await this.audit.record(
        {
          actorType: "ANONYMOUS",
          actorId: null,
          action: "LOGIN_FAILED",
          entityType: "Worker",
          entityId: worker.id,
          metadata: { reason: "bad_pin", attempts },
        },
        ctx,
      )
      throw INVALID_CREDENTIALS()
    }

    // Cuenta desactivada: respuesta genérica (un mensaje propio confirmaría que el PIN era correcto)
    if (!worker.active) {
      await this.audit.record(
        { actorType: "ANONYMOUS", actorId: null, action: "LOGIN_FAILED", entityType: "Worker", entityId: worker.id, metadata: { reason: "disabled" } },
        ctx,
      )
      throw INVALID_CREDENTIALS()
    }

    if (worker.failedLoginAttempts > 0 || worker.lockedUntil) {
      await this.workers.update(worker.id, { failedLoginAttempts: 0, lockedUntil: null })
    }
    return worker
  }
}
