import type { Logger } from "../lib/logger.js"
import type { AuditLogRepository } from "../repositories/audit-log.repository.js"
import type { StaffPrincipal } from "../types/auth.js"
import type { AuditEntry, RequestContext } from "../types/domain.js"

type EntryWithoutContext = Omit<AuditEntry, "ip" | "userAgent" | "requestId">

/**
 * Bitácora de acciones (quién hizo qué, cuándo y desde dónde).
 * Regla: nunca incluir PIN, RUT, notas clínicas ni métricas en `metadata`.
 * Si la escritura falla, se registra en el log de la aplicación y la operación
 * principal continúa (la acción ya ocurrió; no se debe informar un falso error al usuario).
 */
export class AuditService {
  constructor(
    private readonly repo: AuditLogRepository,
    private readonly logger: Logger,
  ) {}

  async record(entry: EntryWithoutContext, ctx: RequestContext): Promise<void> {
    try {
      await this.repo.append({ ...entry, ...ctx })
    } catch (err) {
      this.logger.error({ err, action: entry.action }, "No se pudo escribir en la bitácora de auditoría")
    }
  }

  staff(principal: StaffPrincipal): Pick<AuditEntry, "actorType" | "actorId"> {
    return { actorType: "STAFF", actorId: principal.workerId }
  }
}
