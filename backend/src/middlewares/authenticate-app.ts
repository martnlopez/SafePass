import type { NextFunction, Request, Response } from "express"
import { Errors } from "../errors/app-error.js"
import type { AppService } from "../services/app.service.js"

/**
 * Autenticación de la app: el token es el de Supabase Auth del propio usuario.
 * Se verifica aquí y se reenvía a Supabase para que aplique RLS con esa identidad.
 */
export function authenticateAppUser(app: AppService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get("authorization")
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null
    if (!match?.[1]) throw Errors.unauthorized("Falta el token de acceso", "MISSING_TOKEN")
    req.appUser = await app.authenticate(match[1])
    next()
  }
}
