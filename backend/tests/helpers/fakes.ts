// Repositorios en memoria: permiten probar services, controllers, middlewares y rutas sin PostgreSQL.
import { randomUUID } from "node:crypto"
import { RecordNotFoundError, UniqueConstraintError } from "../../src/errors/app-error.js"
import type { AuditLogRepository } from "../../src/repositories/audit-log.repository.js"
import type {
  EvaluationChanges,
  EvaluationListFilter,
  EvaluationRepository,
  NewEvaluation,
} from "../../src/repositories/evaluation.repository.js"
import type { HealthRepository } from "../../src/repositories/health.repository.js"
import type { NewTotem, TotemRepository } from "../../src/repositories/totem.repository.js"
import type {
  NewWorker,
  WorkerChanges,
  WorkerListFilter,
  WorkerRepository,
} from "../../src/repositories/worker.repository.js"
import type {
  AuditEntry,
  EvaluationRecord,
  Page,
  PageRequest,
  TotemRecord,
  WorkerRecord,
} from "../../src/types/domain.js"

const slice = <T>(items: T[], page: PageRequest): Page<T> => ({
  items: items.slice((page.page - 1) * page.pageSize, page.page * page.pageSize),
  total: items.length,
})

export class InMemoryWorkers implements WorkerRepository {
  readonly rows = new Map<string, WorkerRecord>()

  async create(data: NewWorker): Promise<WorkerRecord> {
    for (const w of this.rows.values()) {
      if (w.fichaId === data.fichaId) throw new UniqueConstraintError(["ficha_id"])
      if (w.rutHash === data.rutHash) throw new UniqueConstraintError(["rut_hash"])
    }
    const now = new Date()
    const row: WorkerRecord = {
      ...data,
      id: randomUUID(),
      active: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  async findById(id: string) {
    const w = this.rows.get(id)
    return w ? { ...w } : null
  }

  async findByFichaId(fichaId: string) {
    return [...this.rows.values()].find((w) => w.fichaId === fichaId) ?? null
  }

  async findByRutHash(rutHash: string) {
    return [...this.rows.values()].find((w) => w.rutHash === rutHash) ?? null
  }

  async findByPseudonymIds(ids: string[]) {
    return [...this.rows.values()].filter((w) => ids.includes(w.pseudonymId))
  }

  async list(filter: WorkerListFilter, page: PageRequest) {
    const items = [...this.rows.values()]
      .filter((w) => (!filter.crew || w.crew === filter.crew) && (!filter.role || w.role === filter.role))
      .filter((w) => filter.includeInactive || w.active)
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
    return slice(items, page)
  }

  async update(id: string, changes: WorkerChanges) {
    const w = this.rows.get(id)
    if (!w) throw new RecordNotFoundError()
    const next = { ...w, ...changes, updatedAt: new Date() } as WorkerRecord
    this.rows.set(id, next)
    return { ...next }
  }

  async incrementFailedLogins(id: string) {
    const w = this.rows.get(id)
    if (!w) throw new RecordNotFoundError()
    w.failedLoginAttempts += 1
    return w.failedLoginAttempts
  }
}

export class InMemoryTotems implements TotemRepository {
  readonly rows = new Map<string, TotemRecord>()

  async create(data: NewTotem) {
    const row: TotemRecord = { ...data, id: randomUUID(), active: true, lastSeenAt: null }
    this.rows.set(row.id, row)
    return { ...row }
  }

  async findById(id: string) {
    const t = this.rows.get(id)
    return t ? { ...t } : null
  }

  async touch(id: string, at: Date) {
    const t = this.rows.get(id)
    if (t) t.lastSeenAt = at
  }
}

export class InMemoryEvaluations implements EvaluationRepository {
  readonly rows = new Map<string, EvaluationRecord>()

  constructor(
    private readonly totems: InMemoryTotems,
    private readonly now: () => Date,
  ) {}

  async findBySessionId(sessionId: string) {
    const row = [...this.rows.values()].find((e) => e.sessionId === sessionId)
    return row ? { ...row } : null
  }

  async create(data: NewEvaluation) {
    if ([...this.rows.values()].some((e) => e.sessionId === data.sessionId)) {
      throw new UniqueConstraintError(["session_id"])
    }
    const now = this.now()
    const row: EvaluationRecord = {
      ...data,
      id: randomUUID(),
      totemName: this.totems.rows.get(data.totemId)?.name ?? "?",
      supervisorDecision: null,
      supervisorNoteEncrypted: null,
      reviewedById: null,
      reviewedAt: null,
      voidedAt: null,
      voidReason: null,
      voidedById: null,
      createdAt: now,
      updatedAt: now,
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  async findById(id: string) {
    const e = this.rows.get(id)
    return e ? { ...e } : null
  }

  async findLatestActiveBySubject(subjectId: string) {
    return (
      [...this.rows.values()]
        .filter((e) => e.subjectId === subjectId && !e.voidedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    )
  }

  async list(filter: EvaluationListFilter, page: PageRequest) {
    const items = [...this.rows.values()]
      .filter((e) => (!filter.status || e.status === filter.status) && (!filter.subjectId || e.subjectId === filter.subjectId))
      .filter((e) => (!filter.totemId || e.totemId === filter.totemId) && (filter.includeVoided || !e.voidedAt))
      .filter((e) => (!filter.from || e.createdAt >= filter.from) && (!filter.to || e.createdAt <= filter.to))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return slice(items, page)
  }

  async update(id: string, changes: EvaluationChanges) {
    const e = this.rows.get(id)
    if (!e) throw new RecordNotFoundError()
    const next = { ...e, ...changes, updatedAt: this.now() }
    this.rows.set(id, next)
    return { ...next }
  }
}

export class InMemoryAudit implements AuditLogRepository {
  readonly entries: AuditEntry[] = []

  async append(entry: AuditEntry) {
    this.entries.push(entry)
  }
}

export const healthyDb: HealthRepository = { ping: async () => {} }
