import type { NextFunction, Request, Response } from "express"
import { Errors } from "../errors/app-error.js"
import type { AuthService } from "../services/auth.service.js"
import type { AccessRole } from "../types/auth.js"

/** Verifica el JWT (Authorization: Bearer …) y deja la identidad en req.auth */
export function authenticate(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get("authorization")
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null
    if (!match?.[1]) throw Errors.unauthorized("Falta el token de acceso", "MISSING_TOKEN")
    req.auth = await auth.resolvePrincipal(match[1])
    next()
  }
}

/** RBAC: permite el paso solo a los roles indicados */
export function authorize(...roles: AccessRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw Errors.unauthorized()
    if (!roles.includes(req.auth.role)) throw Errors.forbidden()
    next()
  }
}

/** Autentica el dispositivo tótem con el header X-Totem-Key */
export function requireTotemKey(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.totem = await auth.authenticateTotemDevice(req.get("x-totem-key"))
    next()
  }
}
