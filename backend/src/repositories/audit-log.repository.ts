import type { Prisma, PrismaClient } from "../generated/prisma/client.js"
import type { AuditEntry } from "../types/domain.js"

/** Solo inserción: la bitácora no expone update ni delete (y la BD lo impide con un trigger) */
export interface AuditLogRepository {
  append(entry: AuditEntry): Promise<void>
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: PrismaClient) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.ip?.slice(0, 64) ?? null,
        userAgent: entry.userAgent?.slice(0, 256) ?? null,
        requestId: entry.requestId?.slice(0, 64) ?? null,
      },
      select: { id: true },
    })
  }
}
