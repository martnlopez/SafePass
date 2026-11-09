// Tipos de dominio: independientes de Prisma. Los repositorios traducen hacia/desde la BD.

export const ROLES = ["OPERATOR", "SUPERVISOR", "ADMIN"] as const
export type Role = (typeof ROLES)[number]

export const CREWS = ["7x7", "4x3"] as const
export type Crew = (typeof CREWS)[number]

export const TRAFFIC_LIGHTS = ["VERDE", "AMARILLO", "ROJO"] as const
export type TrafficLight = (typeof TRAFFIC_LIGHTS)[number]

export const SUPERVISOR_DECISIONS = [
  "AUTORIZAR_REEVALUACION",
  "REASIGNACION_TAREA",
  "DERIVACION_POLICLINICO",
  "SUSPENSION_TURNO",
] as const
export type SupervisorDecision = (typeof SUPERVISOR_DECISIONS)[number]

export type AuditActorType = "STAFF" | "TOTEM" | "SYSTEM" | "ANONYMOUS"

export interface WorkerRecord {
  id: string
  pseudonymId: string
  fichaId: string
  rutEncrypted: string
  rutHash: string
  fullName: string
  position: string
  company: string | null
  crew: Crew
  role: Role
  active: boolean
  pinHash: string
  failedLoginAttempts: number
  lockedUntil: Date | null
  deactivatedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface TotemRecord {
  id: string
  name: string
  location: string | null
  keyHash: string
  active: boolean
  lastSeenAt: Date | null
}

export interface PvtMetrics {
  meanLatencyMs: number
  medianReactionTimeMs: number
  omissions: number
  falseStarts: number
  totalStimuli: number
  durationSeconds: number
}

export interface EvaluationRecord extends PvtMetrics {
  id: string
  subjectId: string
  totemId: string
  totemName: string
  sessionId: string
  score: number
  computedStatus: TrafficLight
  status: TrafficLight
  scoringVersion: string
  supervisorDecision: SupervisorDecision | null
  supervisorNoteEncrypted: string | null
  reviewedById: string | null
  reviewedAt: Date | null
  voidedAt: Date | null
  voidReason: string | null
  voidedById: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AuditEntry {
  actorType: AuditActorType
  actorId: string | null
  action: string
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
  requestId?: string
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface PageRequest {
  page: number
  pageSize: number
}

export interface Paginated<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export function paginate<T>(page: Page<T>, req: PageRequest): Paginated<T> {
  return {
    data: page.items,
    meta: { page: req.page, pageSize: req.pageSize, total: page.total, totalPages: Math.ceil(page.total / req.pageSize) },
  }
}

/** Contexto de la petición para auditoría */
export interface RequestContext {
  ip?: string
  userAgent?: string
  requestId?: string
}
