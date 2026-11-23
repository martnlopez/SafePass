import type { Request, Response } from "express"
import { Errors } from "../errors/app-error.js"
import { CreateDecisionBody, PassValidationBody, SubmitResultBody, UpdateDecisionBody } from "../schemas/app.schema.js"
import { IdParams } from "../schemas/common.schema.js"
import type { AppService } from "../services/app.service.js"
import type { AppUser } from "../types/app.js"

function requireAppUser(req: Request): AppUser {
  if (!req.appUser) throw Errors.unauthorized()
  return req.appUser
}

/** Controller flaco de la app: valida forma, delega al service y elige el código HTTP */
export class AppController {
  constructor(private readonly app: AppService) {}

  /** GET /app/me */
  me = async (req: Request, res: Response) => {
    res.status(200).json(await this.app.profile(requireAppUser(req)))
  }

  /** GET /app/me/evaluations — historial propio, del más antiguo al más reciente */
  myEvaluations = async (req: Request, res: Response) => {
    res.status(200).json({ data: await this.app.evaluations(requireAppUser(req)) })
  }

  /** GET /app/me/evaluations/latest — `data` es null si aún no rinde ninguna */
  myLatestEvaluation = async (req: Request, res: Response) => {
    res.status(200).json({ data: await this.app.latestEvaluation(requireAppUser(req)) })
  }

  /** GET /app/me/decisions/latest */
  myLatestDecision = async (req: Request, res: Response) => {
    res.status(200).json({ data: await this.app.latestDecision(requireAppUser(req)) })
  }

  /** GET /app/me/access-passes/current — pase vigente más reciente o null */
  myCurrentPass = async (req: Request, res: Response) => {
    res.status(200).json({ data: await this.app.currentPass(requireAppUser(req)) })
  }

  /** POST /app/evaluation-sessions — abre la sesión del test (aplica descansos y autorizaciones) */
  startEvaluation = async (req: Request, res: Response) => {
    const id = await this.app.startEvaluation(requireAppUser(req))
    res.status(201).location(`${req.baseUrl}/evaluation-sessions/${id}`).json({ id })
  }

  /** POST /app/evaluation-sessions/:id/result — 201 la primera vez, 200 con la misma evaluación en un reintento */
  submitResult = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    const { breakdown, durationSeconds } = SubmitResultBody.parse(req.body)
    const evaluation = await this.app.submitEvaluation(requireAppUser(req), id, breakdown, durationSeconds ?? null)
    res.status(evaluation.replayed ? 200 : 201).location(`${req.baseUrl}/evaluation-sessions/${id}/result`).json(evaluation)
  }

  /** POST /app/access-passes — emite o recupera el pase vigente (idempotente) */
  issuePass = async (req: Request, res: Response) => {
    res.status(200).json(await this.app.issuePass(requireAppUser(req)))
  }

  /** POST /app/pass-validations — el supervisor valida un código con el reloj y las reglas del servidor */
  validatePass = async (req: Request, res: Response) => {
    const { code } = PassValidationBody.parse(req.body)
    res.status(200).json(await this.app.validatePass(requireAppUser(req), code))
  }

  /** POST /app/decisions — decisión del supervisor sobre otro trabajador */
  createDecision = async (req: Request, res: Response) => {
    const body = CreateDecisionBody.parse(req.body)
    const decision = await this.app.createDecision(requireAppUser(req), body)
    res.status(201).json(decision)
  }

  /** PATCH /app/decisions/:id — el trabajador marca la decisión como vista */
  updateDecision = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    UpdateDecisionBody.parse(req.body)
    await this.app.markDecisionSeen(requireAppUser(req), id)
    res.status(204).end()
  }

  /** POST /app/decisions/:id/retest-starts — inicia el re-test autorizado tras el descanso */
  startRetest = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    await this.app.startAuthorizedRetest(requireAppUser(req), id)
    res.status(204).end()
  }
}
