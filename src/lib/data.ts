export type Status = "apto" | "semi" | "no"

export const STATUS_META: Record<
  Status,
  { label: string; short: string; text: string; bg: string; border: string; dot: string; hex: string }
> = {
  apto: {
    label: "APTO PARA INGRESO A FAENA",
    short: "Apto",
    text: "text-[color:var(--color-apt)]",
    bg: "bg-[color:var(--color-apt)]/12",
    border: "border-[color:var(--color-apt)]/40",
    dot: "bg-[color:var(--color-apt)]",
    hex: "#22c55e",
  },
  semi: {
    label: "SEMI APTO / RETOMAR TEST",
    short: "Semi apto",
    text: "text-[color:var(--color-semi)]",
    bg: "bg-[color:var(--color-semi)]/12",
    border: "border-[color:var(--color-semi)]/40",
    dot: "bg-[color:var(--color-semi)]",
    hex: "#f59e0b",
  },
  no: {
    label: "NO APTO PARA INGRESAR EN ESTE TURNO",
    short: "No apto",
    text: "text-[color:var(--color-no)]",
    bg: "bg-[color:var(--color-no)]/12",
    border: "border-[color:var(--color-no)]/40",
    dot: "bg-[color:var(--color-no)]",
    hex: "#ef4444",
  },
}

export function scoreToStatus(score: number): Status {
  if (score >= 80) return "apto"
  if (score >= 60) return "semi"
  return "no"
}

export interface Evaluation {
  id: string
  name: string
  rut: string
  role: string
  company: string
  shift: "Día" | "Noche"
  score: number
  time: string
  status: Status
}

const rows: Omit<Evaluation, "status">[] = [
  { id: "TRB-0431", name: "Camila Fuentes", rut: "18.442.901-7", role: "Operadora CAEX", company: "Minera Andina", shift: "Día", score: 94, time: "06:12" },
  { id: "TRB-0288", name: "Rodrigo Salinas", rut: "16.098.334-2", role: "Mantenedor Mecánico", company: "SGS Contratistas", shift: "Día", score: 88, time: "06:18" },
  { id: "TRB-0512", name: "Héctor Manríquez", rut: "13.554.720-9", role: "Operador Perforadora", company: "Minera Andina", shift: "Noche", score: 47, time: "06:21" },
  { id: "TRB-0107", name: "Valentina Rojas", rut: "19.877.145-K", role: "Geóloga de Terreno", company: "Consorcio Sur", shift: "Día", score: 91, time: "06:24" },
  { id: "TRB-0399", name: "Ignacio Peña", rut: "17.220.988-4", role: "Operador Cargador", company: "SGS Contratistas", shift: "Noche", score: 72, time: "06:27" },
  { id: "TRB-0645", name: "Marisol Cárcamo", rut: "15.301.677-1", role: "Supervisora Planta", company: "Minera Andina", shift: "Día", score: 86, time: "06:31" },
  { id: "TRB-0233", name: "Diego Villalobos", rut: "20.114.552-8", role: "Operador CAEX", company: "Consorcio Sur", shift: "Noche", score: 54, time: "06:34" },
  { id: "TRB-0578", name: "Francisca Núñez", rut: "18.990.203-6", role: "Prevencionista", company: "Minera Andina", shift: "Día", score: 97, time: "06:38" },
  { id: "TRB-0461", name: "Sebastián Órdenes", rut: "16.774.319-0", role: "Eléctrico Industrial", company: "SGS Contratistas", shift: "Día", score: 65, time: "06:42" },
  { id: "TRB-0092", name: "Andrés Tapia", rut: "14.209.887-3", role: "Operador Perforadora", company: "Consorcio Sur", shift: "Noche", score: 42, time: "06:45" },
  { id: "TRB-0704", name: "Josefa Miranda", rut: "21.008.774-5", role: "Laboratorista", company: "Minera Andina", shift: "Día", score: 89, time: "06:49" },
  { id: "TRB-0356", name: "Cristián Álvarez", rut: "15.882.640-2", role: "Mantenedor Mecánico", company: "SGS Contratistas", shift: "Noche", score: 78, time: "06:52" },
]

export const EVALUATIONS: Evaluation[] = rows.map((r) => ({ ...r, status: scoreToStatus(r.score) }))

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
  z: number // z-score vs baseline
  breakdown: { key: TestKey; name: string; score: number; detail: string }[]
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
    { test: "Selección de Figuras", score: figuras, value: `Precisión ${precision}%`, threshold: "mín. 80%", severity: scoreToStatus(figuras) },
    { test: "PVT Táctil", score: pvt, value: `TR ${trMs}ms · ${lapsos} lapsos`, threshold: "máx. 500ms", severity: scoreToStatus(pvt) },
    { test: "Go / No-Go", score: gonogo, value: `Falsos + ${fp}%`, threshold: "máx. 15%", severity: scoreToStatus(gonogo) },
    { test: "Memoria de Trabajo", score: memoria, value: `Span ${span} casillas`, threshold: "mín. 4", severity: scoreToStatus(memoria) },
    { test: "Tracking Numérico", score: tracking, value: `${series} series`, threshold: "mín. 3", severity: scoreToStatus(tracking) },
  ]
}
