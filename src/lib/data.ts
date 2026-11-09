export type Status = "apto" | "semi" | "no"

export const STATUS_META: Record<
  Status,
  {
    label: string
    short: string
    range: string // tramo visible de la escala 0-100
    band: string // lectura del tramo para el trabajador
    text: string
    bg: string
    border: string
    dot: string
    hex: string
  }
> = {
  apto: {
    label: "APTO PARA INGRESO A FAENA",
    short: "Apto",
    range: "80 – 100 pts",
    band: "Rango óptimo",
    text: "text-[color:var(--color-apt)]",
    bg: "bg-[color:var(--color-apt)]/12",
    border: "border-[color:var(--color-apt)]/40",
    dot: "bg-[color:var(--color-apt)]",
    hex: "#22c55e",
  },
  semi: {
    label: "SEMI APTO / RETOMAR TEST",
    short: "Semi apto",
    range: "60 – 79 pts",
    band: "Atención preventiva",
    text: "text-[color:var(--color-semi)]",
    bg: "bg-[color:var(--color-semi)]/12",
    border: "border-[color:var(--color-semi)]/40",
    dot: "bg-[color:var(--color-semi)]",
    hex: "#f59e0b",
  },
  no: {
    label: "NO APTO PARA INGRESAR EN ESTE TURNO",
    short: "No apto",
    range: "0 – 59 pts",
    band: "Restricción de acceso",
    text: "text-[color:var(--color-no)]",
    bg: "bg-[color:var(--color-no)]/12",
    border: "border-[color:var(--color-no)]/40",
    dot: "bg-[color:var(--color-no)]",
    hex: "#ef4444",
  },
}

// Escala continua visible en el tótem (0-100 pts). El z-score se mantiene solo
// como métrica interna / de supervisión.
export const SCORE_BANDS: { status: Status; from: number; to: number }[] = [
  { status: "no", from: 0, to: 59 },
  { status: "semi", from: 60, to: 79 },
  { status: "apto", from: 80, to: 100 },
]

export function scoreToStatus(score: number): Status {
  if (score >= 80) return "apto"
  if (score >= 60) return "semi"
  return "no"
}

/** Fila del panel de supervisión: perfil + último resultado (lib/results.ts) */
export interface Evaluation {
  /** Ficha ID */
  id: string
  /** id del trabajador en Supabase (workers.id) */
  workerId: string
  name: string
  role: string
  company: string
  shift: "Día" | "Noche"
  score: number
  time: string
  status: Status
  /** Momento exacto de finalización (ms) */
  completedAt?: number
  /** Desglose real por prueba (ausente en los datos iniciales cargados en la base) */
  breakdown?: TestFault[]
  /** true = evaluación rendida en la app (con desglose real) */
  live?: boolean
}

// Auto-formato de Ficha ID: 3 letras + "-" + hasta 4 dígitos (ej. TRB-0512).
export function formatFicha(raw: string, previous = ""): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
  const letters = cleaned.match(/^[A-Z]{0,3}/)![0]
  const digits = cleaned.slice(letters.length).replace(/\D/g, "").slice(0, 4)
  if (letters.length < 3) return letters
  const deleting = raw.length < previous.length
  if (!digits) return deleting ? letters : `${letters}-`
  return `${letters}-${digits}`
}

// --- Cognitive battery model -------------------------------------------------

export const TEST_META = [
  { key: "figuras", n: 1, name: "Selección de Figuras", metric: "Precisión · velocidad de reacción" },
  { key: "pvt", n: 2, name: "PVT Táctil", metric: "Vigilancia · tiempo de reacción" },
  { key: "gonogo", n: 3, name: "Go / No-Go", metric: "Control inhibitorio" },
  { key: "memoria", n: 4, name: "Memoria de Trabajo", metric: "Span visoespacial" },
  { key: "tracking", n: 5, name: "Tracking Numérico", metric: "Atención sostenida" },
] as const

export type TestKey = (typeof TEST_META)[number]["key"]

export interface BatteryResult {
  fichaId: string
  score: number // 0-100 global
  z: number // z-score vs baseline (uso interno; no se muestra al trabajador)
  breakdown: { key: TestKey; name: string; score: number; detail: string }[]
  /** Hora de finalización fijada por el servidor (ms), una vez guardado */
  completedAt?: number
}

// z-score derived from global score against a modeled baseline (µ=78, σ=11)
export function scoreToZ(score: number): number {
  return Math.round(((score - 78) / 11) * 10) / 10
}

// Per-test detail derived deterministically per worker (supervisor modal).
export interface TestFault {
  test: string
  score: number
  value: string
  threshold: string
  severity: Status
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)))

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = (h ^ id.charCodeAt(i)) * 16777619
  return h >>> 0
}

// Umbral de referencia de cada prueba (se muestra junto al resultado en el panel)
export const TEST_THRESHOLDS: Record<TestKey, string> = {
  figuras: "mín. 80%",
  pvt: "máx. 500ms",
  gonogo: "máx. 15%",
  memoria: "mín. 4",
  tracking: "mín. 3",
}

/** Desglose real de una batería rendida → formato de ficha técnica del panel */
export function breakdownFromResult(breakdown: BatteryResult["breakdown"]): TestFault[] {
  return breakdown.map((b) => ({
    test: b.name,
    score: b.score,
    value: b.detail,
    threshold: TEST_THRESHOLDS[b.key],
    severity: scoreToStatus(b.score),
  }))
}

// Deterministic per-worker breakdown of the last 5 tests, coherent with the
// worker's global score. Same worker always yields the same figures.
export function buildBreakdown(ev: Evaluation): TestFault[] {
  const h = hashId(ev.id)
  const base = ev.score
  // small deterministic per-test offsets (mean ≈ 0) so the average tracks base
  const offsets = [0, 1, 2, 3, 4].map((i) => (((h >> (i * 3)) & 7) - 3.5) * 3)

  const figuras = clamp(base + offsets[0])
  const pvt = clamp(base + offsets[1])
  const gonogo = clamp(base + offsets[2])
  const memoria = clamp(base + offsets[3])
  const tracking = clamp(base + offsets[4])

  const trMs = Math.round(620 - pvt * 2) // higher score → faster reaction
  const lapsos = pvt < 50 ? 3 : pvt < 70 ? 1 : 0
  const precision = clamp(55 + figuras * 0.45)
  const fp = clamp(42 - gonogo * 0.36, 2, 60)
  const span = memoria < 50 ? 2 : memoria < 70 ? 3 : memoria < 85 ? 4 : 5
  const series = Math.max(0, Math.round(tracking / 25))

  return [
    { test: "Selección de Figuras", score: figuras, value: `Precisión ${precision}%`, threshold: TEST_THRESHOLDS.figuras, severity: scoreToStatus(figuras) },
    { test: "PVT Táctil", score: pvt, value: `TR ${trMs}ms · ${lapsos} lapsos`, threshold: TEST_THRESHOLDS.pvt, severity: scoreToStatus(pvt) },
    { test: "Go / No-Go", score: gonogo, value: `Falsos + ${fp}%`, threshold: TEST_THRESHOLDS.gonogo, severity: scoreToStatus(gonogo) },
    { test: "Memoria de Trabajo", score: memoria, value: `Span ${span} casillas`, threshold: TEST_THRESHOLDS.memoria, severity: scoreToStatus(memoria) },
    { test: "Tracking Numérico", score: tracking, value: `${series} series`, threshold: TEST_THRESHOLDS.tracking, severity: scoreToStatus(tracking) },
  ]
}
