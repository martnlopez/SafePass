import { useCallback, useEffect, useState } from "react"
import type { Status } from "./data"
import { api } from "./api"
import { supabase } from "./supabase"

// Decisiones del supervisor sobre un caso (tabla decisions en Supabase), compartidas
// entre el panel de supervisión y la vista del trabajador. El servidor fija la hora,
// el autor y el resultado de referencia; los NO APTO generan automáticamente
// "Revisión pendiente". Ver supabase/migrations.

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
  id: string
  workerId: string
  decision: DecisionId
  /** Comentario visible para el trabajador (null si no hay) */
  note: string | null
  /** Ficha del supervisor; null = registrada automáticamente por el sistema */
  decidedBy: string | null
  decidedAt: number
  /** Resultado que motivó la decisión (escala 0-100) */
  evaluation: { score: number; status: Status } | null
  /** El trabajador vio la decisión al ingresar con su Ficha ID */
  seenAt: number | null
  /** El trabajador usó la autorización (inició el re-test o emitió el pase) */
  consumedAt: number | null
}

interface DecisionRow {
  id: string
  worker_id: string
  decision: DecisionId
  note: string | null
  decided_by_ficha: string | null
  decided_at: string
  evaluation_score: number | null
  evaluation_status: Status | null
  seen_at: string | null
  consumed_at: string | null
}

const COLUMNS =
  "id, worker_id, decision, note, decided_by_ficha, decided_at, evaluation_score, evaluation_status, seen_at, consumed_at"

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null)

function toDecision(row: DecisionRow): SupervisorDecision {
  return {
    id: row.id,
    workerId: row.worker_id,
    decision: row.decision,
    note: row.note,
    decidedBy: row.decided_by_ficha,
    decidedAt: new Date(row.decided_at).getTime(),
    evaluation:
      row.evaluation_score !== null && row.evaluation_status !== null
        ? { score: row.evaluation_score, status: row.evaluation_status }
        : null,
    seenAt: ms(row.seen_at),
    consumedAt: ms(row.consumed_at),
  }
}

/** Decisión tal como la entrega la API SafePass */
interface ApiDecision {
  id: string
  workerId: string
  decision: DecisionId
  note: string | null
  decidedByFicha: string | null
  decidedAt: string
  evaluationScore: number | null
  evaluationStatus: Status | null
  seenAt: string | null
  consumedAt: string | null
}

function fromApi(d: ApiDecision): SupervisorDecision {
  return toDecision({
    id: d.id,
    worker_id: d.workerId,
    decision: d.decision,
    note: d.note,
    decided_by_ficha: d.decidedByFicha,
    decided_at: d.decidedAt,
    evaluation_score: d.evaluationScore,
    evaluation_status: d.evaluationStatus,
    seen_at: d.seenAt,
    consumed_at: d.consumedAt,
  })
}

/** Panel de supervisión: registra una nueva decisión sobre el caso (pasa a ser la vigente) */
export async function saveDecision(input: { workerId: string; decision: DecisionId; note: string }): Promise<SupervisorDecision> {
  const note = input.note.trim().slice(0, NOTE_MAX_LENGTH)
  const saved = await api<ApiDecision>("/app/decisions", {
    method: "POST",
    body: { workerId: input.workerId, decision: input.decision, note: note || null },
  })
  return fromApi(saved)
}

/** Última decisión sobre el propio trabajador */
export async function fetchLatestDecision(): Promise<SupervisorDecision | null> {
  const { data } = await api<{ data: ApiDecision | null }>("/app/me/decisions/latest")
  return data ? fromApi(data) : null
}

/**
 * Decisión que el trabajador debe ver al iniciar sesión: posterior a su último resultado y
 * aún sin usar. Las autorizaciones (re-test / pase) se muestran hasta que se usan; los bloqueos, siempre.
 */
export async function fetchPendingDecisionForWorker(lastResultAt?: number): Promise<SupervisorDecision | null> {
  const d = await fetchLatestDecision()
  if (!d || d.consumedAt !== null) return null
  return isDecisionCurrent(d, lastResultAt) ? d : null
}

/** Re-test autorizado: momento desde el que el trabajador puede volver a rendir (null en otras decisiones) */
export function retestAvailableAt(d: SupervisorDecision): number | null {
  return d.decision === "retest" ? d.decidedAt + RETEST_REST_MINUTES * 60_000 : null
}

/**
 * Una decisión solo sigue vigente si es posterior al último resultado de la ficha:
 * si el trabajador ya rindió una nueva evaluación, la decisión anterior quedó atrás.
 */
export function isDecisionCurrent(d: SupervisorDecision, lastResultAt?: number): boolean {
  return lastResultAt === undefined || d.decidedAt >= lastResultAt
}

/** Marca la decisión como vista por el trabajador (informativo: si falla no bloquea el flujo) */
export async function markDecisionSeen(decisionId: string): Promise<void> {
  await api(`/app/decisions/${encodeURIComponent(decisionId)}`, { method: "PATCH", body: { seen: true } }).catch(() => undefined)
}

/** Inicia el re-test autorizado; el servidor verifica que el descanso ya terminó */
export async function startAuthorizedRetest(decisionId: string): Promise<void> {
  await api(`/app/decisions/${encodeURIComponent(decisionId)}/retest-starts`, { method: "POST" })
}

/** Última decisión de cada trabajador (por workers.id), en tiempo real para el panel */
export function useDecisions(): Record<string, SupervisorDecision> {
  const [map, setMap] = useState<Record<string, SupervisorDecision>>({})

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("latest_decisions").select(COLUMNS).returns<DecisionRow[]>()
    if (error) return
    setMap(Object.fromEntries((data ?? []).map((row) => [row.worker_id, toDecision(row)])))
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel("panel-decisiones")
      .on("postgres_changes", { event: "*", schema: "public", table: "decisions" }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  return map
}

export function formatDecisionTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
}
