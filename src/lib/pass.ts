// Access pass model for the "APTO" result screen. The QR payload and the
// manual validation code are derived from the same random id, so a
// supervisor can cross-check one against the other. TTL logic is expressed
// as absolute timestamps so it maps 1:1 onto a future Backend/DB record
// (issuedAt/expiresAt columns, id as primary key).

export interface AccessPass {
  id: string
  fichaId: string
  issuedAt: number
  expiresAt: number
  code: string
  payload: string
}

export const PASS_TTL_MS = 12 * 60 * 60 * 1000 // 12h

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const PASS_CODE_PREFIX = "SP"
const PASS_CODE_CHARS = 6

function codeFromId(id: string): string {
  const hex = id.replace(/-/g, "").toUpperCase()
  return `${PASS_CODE_PREFIX}-${hex.slice(0, PASS_CODE_CHARS)}`
}

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

export function createAccessPass(fichaId: string): AccessPass {
  const id = randomId()
  const issuedAt = Date.now()
  const expiresAt = issuedAt + PASS_TTL_MS
  const code = codeFromId(id)
  const payload = JSON.stringify({ id, fichaId, issuedAt, expiresAt, code })
  return { id, fichaId, issuedAt, expiresAt, code, payload }
}

// Registro local de pases emitidos (stand-in del Backend/DB): código -> pase.
const REGISTRY_KEY = "safepass:passes"

function readRegistry(): Record<string, AccessPass> {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? "{}")
  } catch {
    return {}
  }
}

export function registerPass(pass: AccessPass) {
  try {
    const all = readRegistry()
    for (const [code, p] of Object.entries(all)) if (isPassExpired(p, Date.now() - PASS_TTL_MS)) delete all[code]
    all[pass.code] = pass
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(all))
  } catch {
    // sin storage: el pase no será verificable
  }
}

export type ValidationResult =
  | { status: "valid" | "expired"; pass: AccessPass }
  | { status: "invalid" }

// Acepta el código manual (SP-2AAE91 / 2AAE91) o el payload JSON leído desde el QR.
export function validatePass(input: string): ValidationResult {
  let code = input.trim().toUpperCase()
  let id: string | undefined
  if (code.startsWith("{")) {
    try {
      const data = JSON.parse(input)
      code = String(data.code ?? "").toUpperCase()
      id = data.id
    } catch {
      return { status: "invalid" }
    }
  }
  code = code.replace(/\s/g, "")
  if (/^[0-9A-F]{6}$/.test(code)) code = `SP-${code}`
  const pass = readRegistry()[code]
  if (!pass || (id && pass.id !== id)) return { status: "invalid" }
  return { status: isPassExpired(pass) ? "expired" : "valid", pass }
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
