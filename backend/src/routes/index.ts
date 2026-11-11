import { Router } from "express"
import type { Container } from "../container.js"
import { AppError } from "../errors/app-error.js"
import { authenticate, authorize, requireTotemKey } from "../middlewares/authenticate.js"
import { authenticateAppUser } from "../middlewares/authenticate-app.js"

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
  api.post("/auth/login", c.limiters.login, c.limiters.loginPerAccount, c.controllers.auth.login)
  api.post(
    "/auth/totem/session",
    c.limiters.login,
    c.limiters.loginPerAccount,
    requireTotemKey(c.services.auth),
    c.controllers.auth.startTotemSession,
  )
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

  // ── App SafePass (datos en Supabase) ──
  api.use("/app", createAppRouter(c))

  return api
}

/**
 * API de la app web/PWA. El token es el de Supabase Auth del propio usuario y cada operación
 * se ejecuta en Supabase con esa identidad: RLS y RPC deciden permisos y reglas.
 *  ─────────────────────────────────────────────────────────────
 *  GET    /app/me                               trabajador o supervisor
 *  GET    /app/me/evaluations                   historial propio
 *  GET    /app/me/evaluations/latest            último resultado propio
 *  GET    /app/me/decisions/latest              última decisión sobre sí mismo
 *  GET    /app/me/access-passes/current         pase vigente propio
 *  POST   /app/evaluation-sessions              abre la sesión del test
 *  POST   /app/evaluation-sessions/:id/result   registra el resultado (idempotente)
 *  POST   /app/access-passes                    emite o recupera el pase (idempotente)
 *  POST   /app/pass-validations                 supervisor
 *  POST   /app/decisions                        supervisor (no sobre sí mismo)
 *  PATCH  /app/decisions/:id                    trabajador: { seen: true }
 *  POST   /app/decisions/:id/retest-starts      trabajador, tras el descanso
 */
function createAppRouter(c: Container): Router {
  const router = Router()
  const app = c.services.app
  const ctl = c.controllers.app
  if (!app || !ctl) {
    // Sin SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY configurados la API de la app queda apagada
    router.use(() => {
      throw new AppError(503, "APP_API_DISABLED", "La API de la app no está configurada en este servidor")
    })
    return router
  }

  router.use(authenticateAppUser(app))
  router.get("/me", ctl.me)
  router.get("/me/evaluations", ctl.myEvaluations)
  router.get("/me/evaluations/latest", ctl.myLatestEvaluation)
  router.get("/me/decisions/latest", ctl.myLatestDecision)
  router.get("/me/access-passes/current", ctl.myCurrentPass)
  router.post("/evaluation-sessions", ctl.startEvaluation)
  router.post("/evaluation-sessions/:id/result", ctl.submitResult)
  router.post("/access-passes", ctl.issuePass)
  router.post("/pass-validations", ctl.validatePass)
  router.post("/decisions", ctl.createDecision)
  router.patch("/decisions/:id", ctl.updateDecision)
  router.post("/decisions/:id/retest-starts", ctl.startRetest)
  return router
}

export function createHealthRouter(c: Container): Router {
  const router = Router()
  router.get("/", c.controllers.health.liveness)
  router.get("/ready", c.controllers.health.readiness)
  return router
}
