import type { HealthRepository } from "../repositories/health.repository.js"
import { DatabaseNotConfiguredError } from "../repositories/unavailable.repository.js"

export class HealthService {
  constructor(private readonly health: HealthRepository) {}

  liveness() {
    return { status: "ok" as const, uptimeSeconds: Math.round(process.uptime()) }
  }

  /** `disabled` = el servidor corre sin base propia (solo la API de la app sobre Supabase) */
  async readiness(): Promise<{ status: "ok" | "unavailable"; database: "up" | "down" | "disabled" }> {
    try {
      await this.health.ping()
      return { status: "ok", database: "up" }
    } catch (err) {
      if (err instanceof DatabaseNotConfiguredError) return { status: "ok", database: "disabled" }
      return { status: "unavailable", database: "down" }
    }
  }
}
