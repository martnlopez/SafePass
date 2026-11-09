import type { HealthRepository } from "../repositories/health.repository.js"

export class HealthService {
  constructor(private readonly health: HealthRepository) {}

  liveness() {
    return { status: "ok" as const, uptimeSeconds: Math.round(process.uptime()) }
  }

  async readiness(): Promise<{ status: "ok" | "unavailable"; database: "up" | "down" }> {
    try {
      await this.health.ping()
      return { status: "ok", database: "up" }
    } catch {
      return { status: "unavailable", database: "down" }
    }
  }
}
