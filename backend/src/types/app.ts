/**
 * Modelo de la app SafePass (datos en Supabase). Las reglas de negocio viven en la base
 * (RLS, triggers y RPC): estos tipos solo describen lo que la API entrega y recibe.
 */

export const APP_STATUSES = ["apto", "semi", "no"] as const
export type AppStatus = (typeof APP_STATUSES)[number]

export const APP_DECISIONS = ["retest", "pase", "revision", "reasignar", "policlinico", "suspender"] as const
export type AppDecisionType = (typeof APP_DECISIONS)[number]

export const BATTERY_KEYS = ["figuras", "gonogo", "memoria", "pvt", "tracking"] as const

/** Usuario de la app identificado por su token de Supabase Auth */
export interface AppUser {
  id: string
  /** Token del propio usuario: Supabase aplica RLS con él en cada consulta */
  token: string
}

export interface AppProfile {
  id: string
  fichaId: string
  fullName: string
  position: string
  company: string | null
  shift: string
  role: "worker" | "supervisor"
}

export interface BatteryEntry {
  key: (typeof BATTERY_KEYS)[number]
  name: string
  detail: string
  score: number
}

export interface AppEvaluation {
  id: string
  workerId: string
  score: number
  status: AppStatus
  completedAt: string
  /** Hora de llegada al servidor (null en filas anteriores a 2026-11-23 sin backfill) */
  receivedAt: string | null
  breakdown: BatteryEntry[] | null
}

export interface AppDecision {
  id: string
  workerId: string
  decision: AppDecisionType
  note: string | null
  decidedByFicha: string | null
  decidedAt: string
  evaluationScore: number | null
  evaluationStatus: AppStatus | null
  seenAt: string | null
  consumedAt: string | null
}

export interface AppPass {
  id: string
  code: string
  fichaId: string
  issuedAt: string
  expiresAt: string
}

export interface PassValidation {
  status: "valid" | "expired" | "revoked" | "invalid"
  reason: "account_disabled" | "supervisor_decision" | "later_evaluation" | null
  pass: AppPass | null
  holder: { fullName: string; position: string; company: string | null } | null
}
