import type { PrismaClient } from "../generated/prisma/client.js"
import type { TotemRecord } from "../types/domain.js"

export interface NewTotem {
  name: string
  location: string | null
  keyHash: string
}

export interface TotemRepository {
  create(data: NewTotem): Promise<TotemRecord>
  findById(id: string): Promise<TotemRecord | null>
  touch(id: string, at: Date): Promise<void>
}

const select = { id: true, name: true, location: true, keyHash: true, active: true, lastSeenAt: true } as const

export class PrismaTotemRepository implements TotemRepository {
  constructor(private readonly db: PrismaClient) {}

  create(data: NewTotem): Promise<TotemRecord> {
    return this.db.totem.create({ data, select })
  }

  findById(id: string): Promise<TotemRecord | null> {
    return this.db.totem.findUnique({ where: { id }, select })
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.totem.update({ where: { id }, data: { lastSeenAt: at }, select: { id: true } })
  }
}
