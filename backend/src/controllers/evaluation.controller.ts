import type { Request, Response } from "express"
import { IdParams } from "../schemas/common.schema.js"
import {
  CreateEvaluationBody,
  ListEvaluationsQuery,
  ReviewEvaluationBody,
  VoidEvaluationBody,
} from "../schemas/evaluation.schema.js"
import type { EvaluationService } from "../services/evaluation.service.js"
import { requestContext, requireStaff, requireTotemSession } from "./helpers.js"

export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  /** POST /api/v1/evaluations — desde el tótem (sesión TOTEM) */
  create = async (req: Request, res: Response) => {
    const dto = CreateEvaluationBody.parse(req.body)
    const result = await this.evaluations.submit(requireTotemSession(req), dto, requestContext(req))
    // 201 + Location la primera vez; 200 con la misma evaluación si es un reintento (eco)
    res.status(result.replayed ? 200 : 201).location(`${req.baseUrl}/evaluations/${result.id}`).json(result)
  }

  /** GET /api/v1/evaluations?status=ROJO&from=…&to=…&page=1&pageSize=20 */
  list = async (req: Request, res: Response) => {
    const query = ListEvaluationsQuery.parse(req.query)
    res.status(200).json(await this.evaluations.list(query, requireStaff(req), requestContext(req)))
  }

  /** GET /api/v1/evaluations/:id */
  getById = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    res.status(200).json(await this.evaluations.getById(id, requireStaff(req), requestContext(req)))
  }

  /** PUT /api/v1/evaluations/:id — dictamen / decisión / observación del supervisor HSE */
  review = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    const dto = ReviewEvaluationBody.parse(req.body)
    res.status(200).json(await this.evaluations.review(id, dto, requireStaff(req), requestContext(req)))
  }

  /** DELETE /api/v1/evaluations/:id — anulación justificada (body: { reason }) */
  void = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    const dto = VoidEvaluationBody.parse(req.body ?? {})
    res.status(200).json(await this.evaluations.void(id, dto, requireStaff(req), requestContext(req)))
  }
}
