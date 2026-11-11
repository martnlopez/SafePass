import { api } from "./api"

// Pase de acceso (tabla access_passes en Supabase, vía la API SafePass). Lo emite el servidor con la función
// issue_access_pass(): genera el código y verifica que el trabajador tenga un resultado
// APTO vigente o un Pase Excepcional del supervisor. El QR y el código manual apuntan al
// mismo registro, así el supervisor puede validar cualquiera de los dos.

export interface AccessPass {
  id: string
  fichaId: string
  issuedAt: number
  expiresAt: number
  code: string
  /** Contenido del QR */
  payload: string
}

export const PASS_CODE_PREFIX = "SP"
const PASS_CODE_CHARS = 6

// Auto-formato del código manual (misma lógica que la Ficha ID): al completar el
// prefijo "SP" se inserta el guion y solo se aceptan los 6 caracteres hex del código.
// Si se escribe directo el código ("2AAE91") se antepone "SP-". Al borrar, el guion
// se quita junto con el último carácter para no trabar la tecla Retroceso.
export function formatPassCode(raw: string, previous = ""): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!cleaned.startsWith(PASS_CODE_PREFIX) && PASS_CODE_PREFIX.startsWith(cleaned)) return cleaned // "" o "S"
  const rest = cleaned.startsWith(PASS_CODE_PREFIX) ? cleaned.slice(PASS_CODE_PREFIX.length) : cleaned
  const body = rest.replace(/[^0-9A-F]/g, "").slice(0, PASS_CODE_CHARS)
  const deleting = raw.length < previous.length
  if (!body) return deleting ? PASS_CODE_PREFIX : `${PASS_CODE_PREFIX}-`
  return `${PASS_CODE_PREFIX}-${body}`
}

export function isCompletePassCode(code: string): boolean {
  return new RegExp(`^${PASS_CODE_PREFIX}-[0-9A-F]{${PASS_CODE_CHARS}}$`).test(code)
}

/** Pase tal como lo entrega la API SafePass */
interface ApiPass {
  id: string
  code: string
  fichaId: string
  issuedAt: string
  expiresAt: string
}

function toPass(p: ApiPass): AccessPass {
  const issuedAt = new Date(p.issuedAt).getTime()
  const expiresAt = new Date(p.expiresAt).getTime()
  return {
    id: p.id,
    code: p.code,
    fichaId: p.fichaId,
    issuedAt,
    expiresAt,
    payload: JSON.stringify({ id: p.id, fichaId: p.fichaId, issuedAt, expiresAt, code: p.code }),
  }
}

/**
 * Pase vigente más reciente del trabajador autenticado. No emite nada: sirve para volver
 * a mostrarlo al iniciar sesión de nuevo.
 */
export async function fetchActivePass(): Promise<AccessPass | null> {
  const { data } = await api<{ data: ApiPass | null }>("/app/me/access-passes/current")
  return data ? toPass(data) : null
}

/** Emite (o recupera, si ya existe uno vigente) el pase del trabajador autenticado */
export async function issueAccessPass(): Promise<AccessPass> {
  return toPass(await api<ApiPass>("/app/access-passes", { method: "POST" }))
}

export interface PassHolder {
  fullName: string
  position: string
  company: string | null
}

/** Motivo por el que el servidor anuló un pase que aún no vencía */
export type RevokeReason = "account_disabled" | "supervisor_decision" | "later_evaluation"

export type ValidationResult =
  | { status: "valid" | "expired"; pass: AccessPass; holder: PassHolder }
  | { status: "revoked"; reason: RevokeReason; pass: AccessPass; holder: PassHolder }
  | { status: "invalid" }
  | { status: "error"; message: string }

interface ApiPassValidation {
  status: "valid" | "expired" | "revoked" | "invalid"
  reason: RevokeReason | null
  pass: ApiPass | null
  holder: PassHolder | null
}

/** Supervisor: acepta el código manual (SP-2AAE91 / 2AAE91) o el contenido JSON del QR */
export async function validatePass(input: string): Promise<ValidationResult> {
  let code = input.trim().toUpperCase()
  let id: string | undefined
  if (code.startsWith("{")) {
    try {
      const data = JSON.parse(input) as { code?: unknown; id?: unknown }
      code = String(data.code ?? "").toUpperCase()
      id = typeof data.id === "string" ? data.id : undefined
    } catch {
      return { status: "invalid" }
    }
  }
  code = code.replace(/\s/g, "")
  if (/^[0-9A-F]{6}$/.test(code)) code = `${PASS_CODE_PREFIX}-${code}`
  if (!isCompletePassCode(code)) return { status: "invalid" }

  // El servidor decide con su reloj y con la elegibilidad actual del trabajador
  // (cuenta activa, decisiones y evaluaciones posteriores a la emisión)
  let result: ApiPassValidation
  try {
    result = await api<ApiPassValidation>("/app/pass-validations", { method: "POST", body: { code } })
  } catch (err) {
    return { status: "error", message: (err as Error).message }
  }
  if (result.status === "invalid" || !result.pass || !result.holder || (id && result.pass.id !== id)) {
    return { status: "invalid" }
  }

  const pass = toPass(result.pass)
  if (result.status === "revoked") {
    return { status: "revoked", reason: result.reason ?? "supervisor_decision", pass, holder: result.holder }
  }
  return { status: result.status, pass, holder: result.holder }
}

export const REVOKE_REASON_TEXT: Record<RevokeReason, string> = {
  account_disabled: "La cuenta del trabajador está deshabilitada.",
  supervisor_decision: "Un supervisor registró una decisión posterior a la emisión del pase.",
  later_evaluation: "El trabajador rindió una evaluación posterior que no fue APTA.",
}

export function isPassExpired(pass: AccessPass, now = Date.now()): boolean {
  return now >= pass.expiresAt
}

export function formatRemaining(pass: AccessPass, now = Date.now()): string {
  const ms = Math.max(0, pass.expiresAt - now)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`
}
