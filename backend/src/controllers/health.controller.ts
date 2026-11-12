import type { Request, Response } from "express"
import type { HealthService } from "../services/health.service.js"

export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /health — el proceso está vivo */
  liveness = (_req: Request, res: Response) => {
    res.status(200).json(this.health.liveness())
  }

  /** GET /health/ready — Supabase (datos y login) responde */
  readiness = async (_req: Request, res: Response) => {
    const result = await this.health.readiness()
    res.status(result.status === "ok" ? 200 : 503).json(result)
  }
}
