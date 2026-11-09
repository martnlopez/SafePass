import type { Request } from "express"
import { Errors } from "../errors/app-error.js"
import type { StaffPrincipal, TotemSessionPrincipal } from "../types/auth.js"
import type { RequestContext } from "../types/domain.js"

export function requestContext(req: Request): RequestContext {
  return {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get("user-agent") ? { userAgent: req.get("user-agent") } : {}),
    ...(req.id !== undefined ? { requestId: String(req.id) } : {}),
  }
}

export function requireStaff(req: Request): StaffPrincipal {
  if (req.auth?.kind !== "staff") throw Errors.forbidden()
  return req.auth
}

export function requireTotemSession(req: Request): TotemSessionPrincipal {
  if (req.auth?.kind !== "totem") throw Errors.forbidden()
  return req.auth
}
