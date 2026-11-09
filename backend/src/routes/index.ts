import { Router } from "express"
import type { Container } from "../container.js"
import { authenticate, authorize, requireTotemKey } from "../middlewares/authenticate.js"

/**
 * Matriz RBAC
 *  ─────────────────────────────────────────────────────────────
 *  POST   /auth/login                 público (rate limit)
 *  POST   /auth/totem/session         X-Totem-Key (rate limit)
 *  GET    /auth/me                    SUPERVISOR · ADMIN
 *  GET    /workers, /workers/:id      SUPERVISOR · ADMIN
 *  POST   /workers                    ADMIN
 *  PUT    /workers/:id                ADMIN
 *  DELETE /workers/:id                ADMIN (desactivación)
 *  POST   /evaluations                TOTEM (sesión de tótem)
 *  GET    /evaluations, /:id          SUPERVISOR · ADMIN
 *  PUT    /evaluations/:id            SUPERVISOR · ADMIN
 *  DELETE /evaluations/:id            ADMIN (anulación justificada)
 */
export function createApiRouter(c: Container): Router {
  const api = Router()
  const auth = authenticate(c.services.auth)
  const staff = authorize("SUPERVISOR", "ADMIN")
  const admin = authorize("ADMIN")

  // ── Auth ──
  api.post("/auth/login", c.limiters.login, c.controllers.auth.login)
  api.post("/auth/totem/session", c.limiters.login, requireTotemKey(c.services.auth), c.controllers.auth.startTotemSession)
  api.get("/auth/me", auth, staff, c.controllers.auth.me)

  // ── Workers ──
  const workers = c.controllers.worker
  api.get("/workers", auth, staff, workers.list)
  api.get("/workers/:id", auth, staff, workers.getById)
  api.post("/workers", auth, admin, workers.create)
  api.put("/workers/:id", auth, admin, workers.update)
  api.delete("/workers/:id", auth, admin, workers.deactivate)

  // ── Evaluations ──
  const evaluations = c.controllers.evaluation
  api.post("/evaluations", auth, authorize("TOTEM"), c.limiters.evaluationSubmit, evaluations.create)
  api.get("/evaluations", auth, staff, evaluations.list)
  api.get("/evaluations/:id", auth, staff, evaluations.getById)
  api.put("/evaluations/:id", auth, staff, evaluations.review)
  api.delete("/evaluations/:id", auth, admin, evaluations.void)

  return api
}

export function createHealthRouter(c: Container): Router {
  const router = Router()
  router.get("/", c.controllers.health.liveness)
  router.get("/ready", c.controllers.health.readiness)
  return router
}
