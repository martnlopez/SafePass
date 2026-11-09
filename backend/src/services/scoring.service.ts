import type { PvtMetrics, TrafficLight } from "../types/domain.js"

/**
 * Puntaje PVT-B → escala 0-100 → dictamen semafórico.
 *
 * - Precisión: "performance score" de Basner & Dinges (2011) = 1 − (omisiones + falsas partidas) / estímulos.
 * - Latencia: 250 ms o menos suma el máximo, 500 ms o más no suma (el umbral de lapso PVT-B, 355 ms, queda al medio).
 * - Puntaje = 100 × (0,6 × precisión + 0,4 × factor de latencia).
 * - Tramos iguales a los del tótem: 80-100 VERDE · 60-79 AMARILLO · 0-59 ROJO.
 *
 * Valores referenciales: deben validarse con un estudio psicométrico antes de producción.
 * Cualquier cambio de fórmula o umbral debe subir SCORING_VERSION (queda guardada en cada evaluación).
 */
export const SCORING_VERSION = "pvtb-1.0"

export const SCORE_THRESHOLDS = { VERDE: 80, AMARILLO: 60 } as const

const LATENCY_BEST_MS = 250
const LATENCY_WORST_MS = 500
const WEIGHT_ACCURACY = 0.6
const WEIGHT_LATENCY = 0.4

export interface ScoreResult {
  score: number
  status: TrafficLight
  version: string
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function scoreToTrafficLight(score: number): TrafficLight {
  if (score >= SCORE_THRESHOLDS.VERDE) return "VERDE"
  if (score >= SCORE_THRESHOLDS.AMARILLO) return "AMARILLO"
  return "ROJO"
}

export function computePvtScore(m: PvtMetrics): ScoreResult {
  const accuracy = clamp(1 - (m.omissions + m.falseStarts) / m.totalStimuli, 0, 1)
  const latency = clamp((LATENCY_WORST_MS - m.meanLatencyMs) / (LATENCY_WORST_MS - LATENCY_BEST_MS), 0, 1)
  const score = Math.round(100 * (WEIGHT_ACCURACY * accuracy + WEIGHT_LATENCY * latency))
  return { score, status: scoreToTrafficLight(score), version: SCORING_VERSION }
}
