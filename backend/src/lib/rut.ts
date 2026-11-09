// Utilidades de RUT chileno (módulo 11)

export function cleanRut(input: string): string {
  return input.replace(/[.\s-]/g, "").toUpperCase()
}

export function computeCheckDigit(body: string): string {
  let sum = 0
  let factor = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const r = 11 - (sum % 11)
  return r === 11 ? "0" : r === 10 ? "K" : String(r)
}

export function isValidRut(input: string): boolean {
  const clean = cleanRut(input)
  if (!/^\d{7,8}[\dK]$/.test(clean)) return false
  return computeCheckDigit(clean.slice(0, -1)) === clean.slice(-1)
}

/** Forma canónica para cifrar e indexar: "12345678-5" */
export function normalizeRut(input: string): string {
  const clean = cleanRut(input)
  const body = String(Number(clean.slice(0, -1)))
  return `${body}-${clean.slice(-1)}`
}

/** "12345678-5" → "12.345.678-5" */
export function formatRut(normalized: string): string {
  const [body = "", dv = ""] = normalized.split("-")
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`
}

/** Minimización de datos para SUPERVISOR: "12.345.678-5" → "**.***.678-5" */
export function maskRut(normalized: string): string {
  return formatRut(normalized).replace(/^(.*)(\d{3}-[\dK])$/, (_, head: string, tail: string) => head.replace(/\d/g, "*") + tail)
}
