import { randomUUID } from "node:crypto"
import jwt from "jsonwebtoken"
import { z } from "zod"
import { Errors } from "../errors/app-error.js"

const StaffClaims = z.object({
  typ: z.literal("staff"),
  sub: z.uuid(),
  role: z.enum(["SUPERVISOR", "ADMIN"]),
  jti: z.uuid(),
})

const TotemSessionClaims = z.object({
  typ: z.literal("totem_session"),
  sub: z.uuid(),
  tid: z.uuid(),
  jti: z.uuid(),
})

const Claims = z.discriminatedUnion("typ", [StaffClaims, TotemSessionClaims])
export type TokenClaims = z.infer<typeof Claims>

export interface TokenSettings {
  secret: string
  issuer: string
  audience: string
  staffTtlSeconds: number
  totemSessionTtlSeconds: number
}

export interface IssuedToken {
  token: string
  expiresIn: number
  jti: string
}

/** Emisión y verificación de JWT (HS256, issuer/audience obligatorios, algoritmo fijo) */
export class TokenService {
  constructor(private readonly settings: TokenSettings) {}

  signStaff(workerId: string, role: "SUPERVISOR" | "ADMIN"): IssuedToken {
    return this.sign({ typ: "staff", role }, workerId, this.settings.staffTtlSeconds)
  }

  /** `subjectId` es el seudónimo del trabajador, nunca su id ni su RUT */
  signTotemSession(subjectId: string, totemId: string): IssuedToken {
    return this.sign({ typ: "totem_session", tid: totemId }, subjectId, this.settings.totemSessionTtlSeconds)
  }

  verify(token: string): TokenClaims {
    let payload: unknown
    try {
      payload = jwt.verify(token, this.settings.secret, {
        algorithms: ["HS256"],
        issuer: this.settings.issuer,
        audience: this.settings.audience,
      })
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw Errors.unauthorized("La sesión expiró", "TOKEN_EXPIRED")
      throw Errors.unauthorized("Token inválido", "INVALID_TOKEN")
    }
    const parsed = Claims.safeParse(payload)
    if (!parsed.success) throw Errors.unauthorized("Token inválido", "INVALID_TOKEN")
    return parsed.data
  }

  private sign(claims: Record<string, unknown>, subject: string, ttl: number): IssuedToken {
    const jti = randomUUID()
    const token = jwt.sign(claims, this.settings.secret, {
      algorithm: "HS256",
      subject,
      issuer: this.settings.issuer,
      audience: this.settings.audience,
      expiresIn: ttl,
      jwtid: jti,
    })
    return { token, expiresIn: ttl, jti }
  }
}
