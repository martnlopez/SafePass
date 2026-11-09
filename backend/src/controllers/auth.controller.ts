import type { Request, Response } from "express"
import { Errors } from "../errors/app-error.js"
import { LoginBody } from "../schemas/auth.schema.js"
import type { AuthService } from "../services/auth.service.js"
import { requestContext, requireStaff } from "./helpers.js"

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/v1/auth/login — panel de supervisión */
  login = async (req: Request, res: Response) => {
    const dto = LoginBody.parse(req.body)
    res.status(200).json(await this.auth.loginStaff(dto, requestContext(req)))
  }

  /** POST /api/v1/auth/totem/session — requiere X-Totem-Key */
  startTotemSession = async (req: Request, res: Response) => {
    if (!req.totem) throw Errors.unauthorized("Clave de tótem requerida", "INVALID_TOTEM_KEY")
    const dto = LoginBody.parse(req.body)
    res.status(201).json(await this.auth.startTotemSession(req.totem, dto, requestContext(req)))
  }

  /** GET /api/v1/auth/me */
  me = async (req: Request, res: Response) => {
    res.status(200).json(await this.auth.me(requireStaff(req)))
  }
}
