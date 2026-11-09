import type { PrismaClient } from "../generated/prisma/client.js"

export interface HealthRepository {
  ping(): Promise<void>
}

export class PrismaHealthRepository implements HealthRepository {
  constructor(private readonly db: PrismaClient) {}

  async ping(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`
  }
}
