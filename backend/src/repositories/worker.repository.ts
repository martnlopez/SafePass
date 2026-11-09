import type { Prisma, PrismaClient, Worker as WorkerRow } from "../generated/prisma/client.js"
import type { Crew as DbCrew } from "../generated/prisma/enums.js"
import type { Crew, Page, PageRequest, Role, WorkerRecord } from "../types/domain.js"
import { translatePrismaError } from "./prisma-errors.js"

export interface NewWorker {
  pseudonymId: string
  fichaId: string
  rutEncrypted: string
  rutHash: string
  fullName: string
  position: string
  company: string | null
  crew: Crew
  role: Role
  pinHash: string
}

export interface WorkerChanges {
  fullName?: string
  position?: string
  company?: string | null
  crew?: Crew
  role?: Role
  active?: boolean
  pinHash?: string
  failedLoginAttempts?: number
  lockedUntil?: Date | null
  deactivatedAt?: Date | null
}

export interface WorkerListFilter {
  crew?: Crew
  role?: Role
  includeInactive: boolean
}

export interface WorkerRepository {
  create(data: NewWorker): Promise<WorkerRecord>
  findById(id: string): Promise<WorkerRecord | null>
  findByFichaId(fichaId: string): Promise<WorkerRecord | null>
  findByRutHash(rutHash: string): Promise<WorkerRecord | null>
  findByPseudonymIds(pseudonymIds: string[]): Promise<WorkerRecord[]>
  list(filter: WorkerListFilter, page: PageRequest): Promise<Page<WorkerRecord>>
  update(id: string, changes: WorkerChanges): Promise<WorkerRecord>
  /** Incremento atómico del contador de intentos fallidos; devuelve el nuevo valor */
  incrementFailedLogins(id: string): Promise<number>
}

const TO_DB_CREW: Record<Crew, DbCrew> = { "7x7": "SHIFT_7X7", "4x3": "SHIFT_4X3" }
const FROM_DB_CREW: Record<DbCrew, Crew> = { SHIFT_7X7: "7x7", SHIFT_4X3: "4x3" }

function toRecord(row: WorkerRow): WorkerRecord {
  return { ...row, crew: FROM_DB_CREW[row.crew] }
}

export class PrismaWorkerRepository implements WorkerRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: NewWorker): Promise<WorkerRecord> {
    const row = await this.db.worker
      .create({ data: { ...data, crew: TO_DB_CREW[data.crew] } })
      .catch(translatePrismaError)
    return toRecord(row)
  }

  async findById(id: string): Promise<WorkerRecord | null> {
    const row = await this.db.worker.findUnique({ where: { id } })
    return row ? toRecord(row) : null
  }

  async findByFichaId(fichaId: string): Promise<WorkerRecord | null> {
    const row = await this.db.worker.findUnique({ where: { fichaId } })
    return row ? toRecord(row) : null
  }

  async findByRutHash(rutHash: string): Promise<WorkerRecord | null> {
    const row = await this.db.worker.findUnique({ where: { rutHash } })
    return row ? toRecord(row) : null
  }

  async findByPseudonymIds(pseudonymIds: string[]): Promise<WorkerRecord[]> {
    if (pseudonymIds.length === 0) return []
    const rows = await this.db.worker.findMany({ where: { pseudonymId: { in: pseudonymIds } } })
    return rows.map(toRecord)
  }

  async list(filter: WorkerListFilter, page: PageRequest): Promise<Page<WorkerRecord>> {
    const where: Prisma.WorkerWhereInput = {
      ...(filter.crew ? { crew: TO_DB_CREW[filter.crew] } : {}),
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.includeInactive ? {} : { active: true }),
    }
    const [rows, total] = await this.db.$transaction([
      this.db.worker.findMany({
        where,
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.worker.count({ where }),
    ])
    return { items: rows.map(toRecord), total }
  }

  async update(id: string, changes: WorkerChanges): Promise<WorkerRecord> {
    const { crew, ...rest } = changes
    const row = await this.db.worker
      .update({ where: { id }, data: { ...rest, ...(crew ? { crew: TO_DB_CREW[crew] } : {}) } })
      .catch(translatePrismaError)
    return toRecord(row)
  }

  async incrementFailedLogins(id: string): Promise<number> {
    const row = await this.db.worker
      .update({ where: { id }, data: { failedLoginAttempts: { increment: 1 } }, select: { failedLoginAttempts: true } })
      .catch(translatePrismaError)
    return row.failedLoginAttempts
  }
}
