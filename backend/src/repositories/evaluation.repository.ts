import type { Prisma, PrismaClient } from "../generated/prisma/client.js"
import type {
  EvaluationRecord,
  Page,
  PageRequest,
  PvtMetrics,
  SupervisorDecision,
  TrafficLight,
} from "../types/domain.js"
import { translatePrismaError } from "./prisma-errors.js"

export interface NewEvaluation extends PvtMetrics {
  subjectId: string
  totemId: string
  sessionId: string
  score: number
  computedStatus: TrafficLight
  status: TrafficLight
  scoringVersion: string
}

export interface EvaluationChanges {
  status?: TrafficLight
  supervisorDecision?: SupervisorDecision
  supervisorNoteEncrypted?: string
  reviewedById?: string
  reviewedAt?: Date
  voidedAt?: Date
  voidReason?: string
  voidedById?: string
}

export interface EvaluationListFilter {
  status?: TrafficLight
  from?: Date
  to?: Date
  totemId?: string
  subjectId?: string
  includeVoided: boolean
}

export interface EvaluationRepository {
  create(data: NewEvaluation): Promise<EvaluationRecord>
  findById(id: string): Promise<EvaluationRecord | null>
  /** Evaluación registrada por una sesión de tótem (eco idempotente de reintentos) */
  findBySessionId(sessionId: string): Promise<EvaluationRecord | null>
  /** Última evaluación no anulada del seudónimo (reglas de re-evaluación) */
  findLatestActiveBySubject(subjectId: string): Promise<EvaluationRecord | null>
  list(filter: EvaluationListFilter, page: PageRequest): Promise<Page<EvaluationRecord>>
  update(id: string, changes: EvaluationChanges): Promise<EvaluationRecord>
}

const withTotem = { totem: { select: { name: true } } } as const
type Row = Prisma.EvaluationGetPayload<{ include: typeof withTotem }>

function toRecord({ totem, ...row }: Row): EvaluationRecord {
  return { ...row, totemName: totem.name }
}

export class PrismaEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewEvaluation): Promise<EvaluationRecord> {
    return toRecord(await this.db.evaluation.create({ data, include: withTotem }).catch(translatePrismaError))
  }

  async findById(id: string): Promise<EvaluationRecord | null> {
    const row = await this.db.evaluation.findUnique({ where: { id }, include: withTotem })
    return row ? toRecord(row) : null
  }

  async findBySessionId(sessionId: string): Promise<EvaluationRecord | null> {
    const row = await this.db.evaluation.findUnique({ where: { sessionId }, include: withTotem })
    return row ? toRecord(row) : null
  }

  async findLatestActiveBySubject(subjectId: string): Promise<EvaluationRecord | null> {
    const row = await this.db.evaluation.findFirst({
      where: { subjectId, voidedAt: null },
      orderBy: { createdAt: "desc" },
      include: withTotem,
    })
    return row ? toRecord(row) : null
  }

  async list(filter: EvaluationListFilter, page: PageRequest): Promise<Page<EvaluationRecord>> {
    const where: Prisma.EvaluationWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.totemId ? { totemId: filter.totemId } : {}),
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      ...(filter.includeVoided ? {} : { voidedAt: null }),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    }
    const [rows, total] = await this.db.$transaction([
      this.db.evaluation.findMany({
        where,
        include: withTotem,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.evaluation.count({ where }),
    ])
    return { items: rows.map(toRecord), total }
  }

  async update(id: string, changes: EvaluationChanges): Promise<EvaluationRecord> {
    return toRecord(
      await this.db.evaluation.update({ where: { id }, data: changes, include: withTotem }).catch(translatePrismaError),
    )
  }
}
