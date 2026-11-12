import { Router } from "express"
import type { Container } from "../container.js"
import { authenticateAppUser } from "../middlewares/authenticate-app.js"

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
export function createApiRouter(c: Container): Router {
  const api = Router()
  api.use("/app", createAppRouter(c))
  return api
}

function createAppRouter(c: Container): Router {
  const router = Router()
  const ctl = c.controllers.app

  router.use(authenticateAppUser(c.services.app))
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
