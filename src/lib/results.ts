import { useCallback, useEffect, useState } from "react"
import { breakdownFromResult, type BatteryResult, type Evaluation, type Status } from "./data"
import { api } from "./api"
import { describeError, isTransientError, supabase } from "./supabase"

// Resultados de las evaluaciones. Las operaciones del trabajador pasan por la API SafePass;
// el panel del supervisor lee en vivo desde Supabase Realtime (con las mismas reglas RLS).

export interface StoredResult {
  id: string
  workerId: string
  score: number
  status: Status
  /** Momento exacto de finalización (ms) */
  completedAt: number
  /** null en resultados cargados como datos iniciales (sin desglose real) */
  breakdown: BatteryResult["breakdown"] | null
}

interface EvaluationRow {
  id: string
  worker_id: string
  score: number
  status: Status
  completed_at: string
  breakdown: BatteryResult["breakdown"] | null
}

const COLUMNS = "id, worker_id, score, status, completed_at, breakdown"

function toResult(row: EvaluationRow): StoredResult {
  return {
    id: row.id,
    workerId: row.worker_id,
    score: row.score,
    status: row.status,
    completedAt: new Date(row.completed_at).getTime(),
    breakdown: row.breakdown,
  }
}

/** Evaluación tal como la entrega la API SafePass */
interface ApiEvaluation {
  id: string
  workerId: string
  score: number
  status: Status
  completedAt: string
  breakdown: BatteryResult["breakdown"] | null
  replayed?: boolean
}

function fromApi(e: ApiEvaluation): StoredResult {
  return {
    id: e.id,
    workerId: e.workerId,
    score: e.score,
    status: e.status,
    completedAt: new Date(e.completedAt).getTime(),
    breakdown: e.breakdown,
  }
}

/**
 * Abre una sesión de evaluación en el servidor. Solo se puede registrar un resultado
 * dentro de una sesión: el servidor mide la duración y acepta un único envío.
 */
export async function startEvaluation(): Promise<string> {
  const { id } = await api<{ id: string }>("/app/evaluation-sessions", { method: "POST" })
  return id
}

/** Esperas entre reintentos del envío (crecientes): ~11 s en total antes de rendirse */
const SUBMIT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Registra la evaluación terminada de la sesión; puntaje, estado y hora los fija el servidor.
 * El envío es idempotente por sesión (el servidor devuelve la misma evaluación si ya llegó),
 * así que ante un corte de red se reintenta solo con espera creciente.
 */
export async function recordResult(sessionId: string, result: BatteryResult): Promise<StoredResult> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= SUBMIT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const saved = await api<ApiEvaluation>(`/app/evaluation-sessions/${encodeURIComponent(sessionId)}/result`, {
        method: "POST",
        body: { breakdown: result.breakdown },
      })
      return fromApi(saved)
    } catch (err) {
      lastError = err
    }
    if (!isTransientError(lastError) || attempt === SUBMIT_RETRY_DELAYS_MS.length) break
    await sleep(SUBMIT_RETRY_DELAYS_MS[attempt])
  }
  throw lastError instanceof Error ? lastError : new Error(describeError(lastError))
}

/** Historial propio, del más antiguo al más reciente */
export async function fetchHistory(): Promise<StoredResult[]> {
  const { data } = await api<{ data: ApiEvaluation[] }>("/app/me/evaluations")
  return data.map(fromApi)
}

/** Último resultado propio (null si aún no rinde ninguna evaluación) */
export async function fetchLatestResult(): Promise<StoredResult | null> {
  const { data } = await api<{ data: ApiEvaluation | null }>("/app/me/evaluations/latest")
  return data ? fromApi(data) : null
}

export function formatCompletedTime(ts: number, withSeconds = false): string {
  const d = new Date(ts)
  // 24 h, igual que el resto del panel (06:24), sin "a. m./p. m."
  const time = d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  })
  const today = new Date().toDateString() === d.toDateString()
  return today ? time : `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })} ${time}`
}

/** Horario del turno de día (hora de Chile): el test se rinde antes de entrar, así que 06–18 = Día, 18–06 = Noche */
const DAY_SHIFT_START_HOUR = 6
const DAY_SHIFT_END_HOUR = 18
const chileHour = new Intl.DateTimeFormat("es-CL", { hour: "numeric", hourCycle: "h23", timeZone: "America/Santiago" })

/** Turno al que corresponde una evaluación según la hora en que se rindió */
export function shiftAt(ts: number): "Día" | "Noche" {
  const hour = Number(chileHour.format(new Date(ts)))
  return hour >= DAY_SHIFT_START_HOUR && hour < DAY_SHIFT_END_HOUR ? "Día" : "Noche"
}

interface WorkerRow {
  id: string
  ficha_id: string
  full_name: string
  position: string
  company: string | null
  shift: "Día" | "Noche"
}

/** Fila del panel: perfil del trabajador + su último resultado */
function toPanelRow(worker: WorkerRow, latest: StoredResult, flags: string[] | undefined): Evaluation {
  return {
    id: worker.ficha_id,
    workerId: worker.id,
    name: worker.full_name,
    role: worker.position,
    company: worker.company ?? "Sin empresa",
    // El turno se toma de la hora del test, no del turno fijo de la ficha
    shift: shiftAt(latest.completedAt),
    score: latest.score,
    status: latest.status,
    time: formatCompletedTime(latest.completedAt),
    completedAt: latest.completedAt,
    ...(latest.breakdown ? { breakdown: breakdownFromResult(latest.breakdown), live: true } : {}),
    ...(flags && flags.length > 0 ? { flags } : {}),
  }
}

async function fetchPanelRows(): Promise<Evaluation[]> {
  const [workers, latest, flagged] = await Promise.all([
    supabase.from("workers").select("id, ficha_id, full_name, position, company, shift").order("ficha_id").returns<WorkerRow[]>(),
    supabase.from("latest_evaluations").select(COLUMNS).returns<EvaluationRow[]>(),
    // Las marcas son una ayuda: si no se pueden leer, el panel funciona igual, sin ellas
    supabase.rpc("list_flagged_evaluations"),
  ])
  if (workers.error) throw new Error(describeError(workers.error))
  if (latest.error) throw new Error(describeError(latest.error))
  const byWorker = new Map((latest.data ?? []).map((r) => [r.worker_id, toResult(r)]))
  const flaggedRows = (flagged.data ?? []) as { evaluation_id: string; flags: string[] }[]
  const flagsByEvaluation = new Map(flaggedRows.map((f) => [f.evaluation_id, f.flags]))
  return (workers.data ?? [])
    .filter((w) => byWorker.has(w.id))
    .map((w) => toPanelRow(w, byWorker.get(w.id)!, flagsByEvaluation.get(byWorker.get(w.id)!.id)))
    // Más recientes primero: lo último que llega al panel queda arriba
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
}

export interface PanelState {
  evaluations: Evaluation[]
  loading: boolean
  error: string | null
}

/**
 * Evaluaciones del turno para el panel de supervisión: último resultado de cada trabajador.
 * Se actualiza en tiempo real cuando cualquier dispositivo registra una evaluación.
 */
export function useEvaluations(): PanelState {
  const [state, setState] = useState<PanelState>({ evaluations: [], loading: true, error: null })

  const load = useCallback(async () => {
    try {
      const evaluations = await fetchPanelRows()
      setState({ evaluations, loading: false, error: null })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }))
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel("panel-evaluaciones")
      .on("postgres_changes", { event: "*", schema: "public", table: "evaluations" }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  return state
}
