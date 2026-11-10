import type { Request, Response } from "express"
import { IdParams } from "../schemas/common.schema.js"
import { CreateWorkerBody, ListWorkersQuery, UpdateWorkerBody } from "../schemas/worker.schema.js"
import type { WorkerService } from "../services/worker.service.js"
import { requestContext, requireStaff } from "./helpers.js"

export class WorkerController {
  constructor(private readonly workers: WorkerService) {}

  /** POST /api/v1/workers */
  create = async (req: Request, res: Response) => {
    const dto = CreateWorkerBody.parse(req.body)
    const worker = await this.workers.create(dto, requireStaff(req), requestContext(req))
    res.status(201).location(`${req.baseUrl}/workers/${worker.id}`).json(worker)
  }

  /** GET /api/v1/workers?crew=7x7&page=1&pageSize=20 */
  list = async (req: Request, res: Response) => {
    const query = ListWorkersQuery.parse(req.query)
    res.status(200).json(await this.workers.list(query, requireStaff(req)))
  }

  /** GET /api/v1/workers/:id */
  getById = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    res.status(200).json(await this.workers.getById(id, requireStaff(req), requestContext(req)))
  }

  /** PUT /api/v1/workers/:id */
  update = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    const dto = UpdateWorkerBody.parse(req.body)
    res.status(200).json(await this.workers.update(id, dto, requireStaff(req), requestContext(req)))
  }

  /** DELETE /api/v1/workers/:id — soft-delete (desactivación) */
  deactivate = async (req: Request, res: Response) => {
    const { id } = IdParams.parse(req.params)
    res.status(200).json(await this.workers.deactivate(id, requireStaff(req), requestContext(req)))
  }
}
