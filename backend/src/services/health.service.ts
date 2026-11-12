import type { AppDataRepository } from "../repositories/app-data.repository.js"

export class HealthService {
  constructor(private readonly data: AppDataRepository) {}

  liveness() {
    return { status: "ok" as const, uptimeSeconds: Math.round(process.uptime()) }
  }

  /** Supabase (datos y login) responde */
  async readiness(): Promise<{ status: "ok" | "unavailable"; supabase: "up" | "down" }> {
    try {
      await this.data.ping()
      return { status: "ok", supabase: "up" }
    } catch {
      return { status: "unavailable", supabase: "down" }
    }
  }
}
