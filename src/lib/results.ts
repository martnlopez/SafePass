import { useCallback, useEffect, useState } from "react"
import { breakdownFromResult, type BatteryResult, type Evaluation, type Status } from "./data"
import { describeError, supabase } from "./supabase"

// Resultados de las evaluaciones en Supabase (tabla evaluations). El servidor fija
// la hora de finalización y aplica las reglas de re-evaluación al insertar.

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

/** Registra una evaluación terminada (APTO, SEMI APTO o NO APTO) del trabajador autenticado */
export async function recordResult(workerId: string, result: BatteryResult): Promise<StoredResult> {
  const { data, error } = await supabase
    .from("evaluations")
    .insert({ worker_id: workerId, score: result.score, status: statusOf(result.score), breakdown: result.breakdown })
    .select(COLUMNS)
    .single<EvaluationRow>()
  if (error || !data) throw new Error(describeError(error))
  return toResult(data)
}

function statusOf(score: number): Status {
  if (score >= 80) return "apto"
  if (score >= 60) return "semi"
  return "no"
}

/** Historial de un trabajador, del más antiguo al más reciente */
export async function fetchHistory(workerId: string): Promise<StoredResult[]> {
  const { data, error } = await supabase
    .from("evaluations")
    .select(COLUMNS)
    .eq("worker_id", workerId)
    .order("completed_at", { ascending: true })
    .returns<EvaluationRow[]>()
  if (error) throw new Error(describeError(error))
  return (data ?? []).map(toResult)
}

export async function fetchLatestResult(workerId: string): Promise<StoredResult | null> {
  const { data, error } = await supabase
    .from("latest_evaluations")
    .select(COLUMNS)
    .eq("worker_id", workerId)
    .maybeSingle<EvaluationRow>()
  if (error) throw new Error(describeError(error))
  return data ? toResult(data) : null
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

interface WorkerRow {
  id: string
  ficha_id: string
  full_name: string
  position: string
  company: string | null
  shift: "Día" | "Noche"
}

/** Fila del panel: perfil del trabajador + su último resultado */
function toPanelRow(worker: WorkerRow, latest: StoredResult): Evaluation {
  return {
    id: worker.ficha_id,
    workerId: worker.id,
    name: worker.full_name,
    role: worker.position,
    company: worker.company ?? "Sin empresa",
    shift: worker.shift,
    score: latest.score,
    status: latest.status,
    time: formatCompletedTime(latest.completedAt),
    completedAt: latest.completedAt,
    ...(latest.breakdown ? { breakdown: breakdownFromResult(latest.breakdown), live: true } : {}),
  }
}

async function fetchPanelRows(): Promise<Evaluation[]> {
  const [workers, latest] = await Promise.all([
    supabase.from("workers").select("id, ficha_id, full_name, position, company, shift").order("ficha_id").returns<WorkerRow[]>(),
    supabase.from("latest_evaluations").select(COLUMNS).returns<EvaluationRow[]>(),
  ])
  if (workers.error) throw new Error(describeError(workers.error))
  if (latest.error) throw new Error(describeError(latest.error))
  const byWorker = new Map((latest.data ?? []).map((r) => [r.worker_id, toResult(r)]))
  return (workers.data ?? [])
    .filter((w) => byWorker.has(w.id))
    .map((w) => toPanelRow(w, byWorker.get(w.id)!))
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
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
