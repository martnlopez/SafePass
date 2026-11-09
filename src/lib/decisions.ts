import { useEffect, useState } from "react"
import { scoreToStatus, type BatteryResult, type Status } from "./data"

// Decisiones del supervisor sobre un caso, compartidas entre el panel de
// supervisión y la vista del trabajador. Persistidas por Ficha ID en
// localStorage (stand-in del Backend/DB, igual que pass.ts y block.ts): el
// registro mapea 1:1 a evaluations.supervisor_decision / supervisor_note.

/** Descanso obligatorio antes del re-test autorizado, contado desde que el supervisor notifica */
export const RETEST_REST_MINUTES = 15

export type DecisionId = "retest" | "pase" | "revision" | "reasignar" | "policlinico" | "suspender"

/** Qué puede hacer el trabajador tras leer la decisión */
export type DecisionEffect =
  | "retest" // puede iniciar una nueva evaluación cuando termine el descanso
  | "pass" // puede emitir su pase de acceso sin rendir
  | "block" // no puede rendir: debe presentarse con su supervisor

export interface DecisionOption {
  id: DecisionId
  /** Panel de supervisión */
  label: string
  sub: string
  /** Etiqueta corta para tablas y tarjetas */
  short: string
  /** Vista del trabajador */
  workerTitle: string
  workerMessage: string
  tone: Status
  effect: DecisionEffect
}

export const DECISIONS: readonly DecisionOption[] = [
  {
    id: "retest",
    label: "Autorizar Re-test",
    sub: `Nuevo intento tras ${RETEST_REST_MINUTES} min de descanso e hidratación`,
    short: "Re-test autorizado",
    workerTitle: "Re-evaluación autorizada",
    workerMessage: `Tu supervisor autorizó un nuevo intento. Podrás comenzar cuando se cumplan los ${RETEST_REST_MINUTES} minutos de descanso; aprovecha de hidratarte.`,
    tone: "semi",
    effect: "retest",
  },
  {
    id: "pase",
    label: "Pase Excepcional",
    sub: "Ingreso autorizado bajo responsabilidad del supervisor",
    short: "Pase excepcional",
    workerTitle: "Pase excepcional otorgado",
    workerMessage: "Tu supervisor autorizó tu ingreso a faena para este turno. Genera tu pase de acceso para presentarlo cuando se te solicite.",
    tone: "apto",
    effect: "pass",
  },
  {
    id: "revision",
    label: "Revisión Pendiente",
    sub: "El caso queda en evaluación del supervisor",
    short: "Revisión pendiente",
    workerTitle: "Revisión pendiente",
    workerMessage:
      "Tu supervisor está revisando tu resultado. No puedes rendir la evaluación hasta recibir una indicación.",
    tone: "semi",
    effect: "block",
  },
  {
    id: "reasignar",
    label: "Reasignación de Tarea",
    sub: "Rol de bajo riesgo / taller",
    short: "Reasignado",
    workerTitle: "Reasignación de tarea",
    workerMessage: "En este turno se te asignará una tarea de bajo riesgo. Preséntate con tu supervisor para recibir tu nueva asignación.",
    tone: "semi",
    effect: "block",
  },
  {
    id: "policlinico",
    label: "Derivación a Policlínico / Mutual",
    sub: "Evaluación médica presencial",
    short: "Derivado a policlínico",
    workerTitle: "Derivación a evaluación médica",
    workerMessage: "Dirígete al policlínico o a la Mutual para una evaluación presencial antes de reincorporarte.",
    tone: "no",
    effect: "block",
  },
  {
    id: "suspender",
    label: "Restablecimiento / Suspensión de Turno",
    sub: "Retiro de faena por seguridad",
    short: "Turno suspendido",
    workerTitle: "Turno suspendido",
    workerMessage: "Por seguridad, no ingresarás a faena en este turno. Contacta a tu supervisor para coordinar tu retiro.",
    tone: "no",
    effect: "block",
  },
]

export const NOTE_MAX_LENGTH = 280

export function decisionOption(id: DecisionId): DecisionOption {
  return DECISIONS.find((d) => d.id === id)!
}

export interface SupervisorDecision {
  fichaId: string
  decision: DecisionId
  /** Comentario visible para el trabajador (null si no hay) */
  note: string | null
  /** Ficha del supervisor; null = registrada automáticamente por el sistema */
  decidedBy: string | null
  decidedAt: number
  /** Resultado que motivó la decisión (escala 0-100) */
  evaluation: { score: number; status: Status }
  /** El trabajador vio la decisión al ingresar con su Ficha ID */
  seenAt: number | null
  /** El trabajador usó la autorización (inició el re-test o emitió el pase) */
  consumedAt: number | null
}

const PREFIX = "safepass:decision:"
const key = (fichaId: string) => `${PREFIX}${fichaId.toUpperCase()}`
const CHANGE_EVENT = "safepass:decision-change"

function isDecision(v: unknown): v is SupervisorDecision {
  const d = v as SupervisorDecision
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.fichaId === "string" &&
    DECISIONS.some((o) => o.id === d.decision) &&
    typeof d.decidedAt === "number" &&
    typeof d.evaluation?.score === "number"
  )
}

export function getDecision(fichaId: string): SupervisorDecision | null {
  try {
    const raw = localStorage.getItem(key(fichaId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isDecision(parsed) ? parsed : null
  } catch {
    return null
  }
}

function write(record: SupervisorDecision) {
  try {
    localStorage.setItem(key(record.fichaId), JSON.stringify(record))
  } catch {
    // sin storage: la decisión no llega a la vista del trabajador
  }
  // Mismo documento: el evento `storage` solo llega a las otras pestañas
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: record.fichaId }))
}

/** Panel de supervisión: registra (o reemplaza) la decisión vigente del caso */
export function saveDecision(input: {
  fichaId: string
  decision: DecisionId
  note: string
  decidedBy: string | null
  score: number
}): SupervisorDecision {
  const note = input.note.trim().slice(0, NOTE_MAX_LENGTH)
  const record: SupervisorDecision = {
    fichaId: input.fichaId.toUpperCase(),
    decision: input.decision,
    note: note || null,
    decidedBy: input.decidedBy,
    decidedAt: Date.now(),
    evaluation: { score: input.score, status: scoreToStatus(input.score) },
    seenAt: null,
    consumedAt: null,
  }
  write(record)
  return record
}

/**
 * Resultado NO APTO: el caso queda automáticamente en "Revisión pendiente"
 * hasta que el supervisor decida (el trabajador no puede volver a rendir por su cuenta).
 */
export function registerPendingReview(result: BatteryResult) {
  write({
    fichaId: result.fichaId.toUpperCase(),
    decision: "revision",
    note: null,
    decidedBy: null,
    decidedAt: Date.now(),
    evaluation: { score: result.score, status: scoreToStatus(result.score) },
    seenAt: null,
    consumedAt: null,
  })
}

/**
 * Decisión que el trabajador debe ver al iniciar sesión.
 * Las autorizaciones (re-test / pase) se muestran hasta que se usan; los bloqueos, siempre.
 */
export function getPendingDecisionForWorker(fichaId: string): SupervisorDecision | null {
  const d = getDecision(fichaId)
  if (!d) return null
  return d.consumedAt === null ? d : null
}

/** Re-test autorizado: momento desde el que el trabajador puede volver a rendir (null en otras decisiones) */
export function retestAvailableAt(d: SupervisorDecision): number | null {
  return d.decision === "retest" ? d.decidedAt + RETEST_REST_MINUTES * 60_000 : null
}

/**
 * Una decisión solo sigue vigente en el panel si es posterior al último resultado de la ficha:
 * si el trabajador ya rindió una nueva evaluación, la decisión anterior quedó atrás.
 */
export function isDecisionCurrent(d: SupervisorDecision, lastResultAt?: number): boolean {
  return lastResultAt === undefined || d.decidedAt >= lastResultAt
}

export function markDecisionSeen(fichaId: string) {
  const d = getDecision(fichaId)
  if (d && d.seenAt === null) write({ ...d, seenAt: Date.now() })
}

export function markDecisionConsumed(fichaId: string) {
  const d = getDecision(fichaId)
  if (d && decisionOption(d.decision).effect !== "block") write({ ...d, consumedAt: Date.now() })
}

/** Decisiones de varias fichas, actualizadas al guardar en esta pestaña o en otra (trabajador / panel) */
export function useDecisions(fichaIds: readonly string[]): Record<string, SupervisorDecision | null> {
  const load = () => Object.fromEntries(fichaIds.map((id) => [id.toUpperCase(), getDecision(id)]))
  const [map, setMap] = useState(load)
  const idsKey = fichaIds.join("|")

  useEffect(() => {
    const refresh = () => setMap(load())
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(PREFIX)) refresh()
    }
    refresh()
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener("storage", onStorage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return map
}

export function formatDecisionTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
}
