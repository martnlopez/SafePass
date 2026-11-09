import { describeError, supabase } from "./supabase"

// Pase de acceso (tabla access_passes en Supabase). Lo emite el servidor con la función
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

function toPass(p: { id: string; code: string; ficha_id: string; issued_at: string; expires_at: string }): AccessPass {
  const issuedAt = new Date(p.issued_at).getTime()
  const expiresAt = new Date(p.expires_at).getTime()
  return {
    id: p.id,
    code: p.code,
    fichaId: p.ficha_id,
    issuedAt,
    expiresAt,
    payload: JSON.stringify({ id: p.id, fichaId: p.ficha_id, issuedAt, expiresAt, code: p.code }),
  }
}

/** Emite (o recupera, si ya existe uno vigente) el pase del trabajador autenticado */
export async function issueAccessPass(): Promise<AccessPass> {
  const { data, error } = await supabase.rpc("issue_access_pass")
  if (error || !data) throw new Error(describeError(error))
  return toPass(data as { id: string; code: string; ficha_id: string; issued_at: string; expires_at: string })
}

export interface PassHolder {
  fullName: string
  position: string
  company: string | null
}

export type ValidationResult =
  | { status: "valid" | "expired"; pass: AccessPass; holder: PassHolder }
  | { status: "invalid" }
  | { status: "error"; message: string }

interface PassRow {
  id: string
  code: string
  issued_at: string
  expires_at: string
  workers: { ficha_id: string; full_name: string; position: string; company: string | null } | null
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

  const { data, error } = await supabase
    .from("access_passes")
    .select("id, code, issued_at, expires_at, workers(ficha_id, full_name, position, company)")
    .eq("code", code)
    .maybeSingle<PassRow>()
  if (error) return { status: "error", message: describeError(error) }
  if (!data || !data.workers || (id && data.id !== id)) return { status: "invalid" }

  const pass = toPass({ ...data, ficha_id: data.workers.ficha_id })
  const holder = { fullName: data.workers.full_name, position: data.workers.position, company: data.workers.company }
  return { status: isPassExpired(pass) ? "expired" : "valid", pass, holder }
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
