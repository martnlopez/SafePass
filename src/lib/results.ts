import { useEffect, useMemo, useState } from "react"
import { breakdownFromResult, EVALUATIONS, scoreToStatus, type BatteryResult, type Evaluation, type Status } from "./data"

// Resultados reales de las evaluaciones rendidas en la app, por Ficha ID
// (stand-in del Backend/DB, igual que pass.ts / decisions.ts). Los datos de
// ejemplo (EVALUATIONS) nunca se escriben aquí: se combinan al leer, así que
// recargar la página o cambiar de sesión jamás pisa un resultado real.

export interface StoredResult {
  fichaId: string
  score: number
  status: Status
  /** Momento exacto de finalización (ms) */
  completedAt: number
  breakdown: BatteryResult["breakdown"]
}

type ResultStore = Record<string, StoredResult[]>

const KEY = "safepass:results"
const CHANGE_EVENT = "safepass:results-change"
/** Historial máximo por ficha (el más antiguo se descarta) */
const MAX_HISTORY = 30

function isResult(v: unknown): v is StoredResult {
  const r = v as StoredResult
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.fichaId === "string" &&
    typeof r.score === "number" &&
    typeof r.completedAt === "number" &&
    Array.isArray(r.breakdown)
  )
}

function readStore(): ResultStore {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (typeof parsed !== "object" || parsed === null) return {}
    const store: ResultStore = {}
    for (const [ficha, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) store[ficha] = list.filter(isResult)
    }
    return store
  } catch {
    return {}
  }
}

/** Registra una evaluación terminada (APTO, SEMI APTO o NO APTO) */
export function recordResult(result: BatteryResult, completedAt = Date.now()): StoredResult {
  const entry: StoredResult = {
    fichaId: result.fichaId.toUpperCase(),
    score: result.score,
    status: scoreToStatus(result.score),
    completedAt,
    breakdown: result.breakdown,
  }
  const store = readStore()
  store[entry.fichaId] = [...(store[entry.fichaId] ?? []), entry].slice(-MAX_HISTORY)
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // sin storage: el resultado no llega al panel de supervisión
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
  return entry
}

/** Historial de una ficha, del más antiguo al más reciente */
export function getHistory(fichaId: string): StoredResult[] {
  return readStore()[fichaId.toUpperCase()] ?? []
}

/** Estado del registro, actualizado al guardar en esta pestaña o en otra (trabajador ↔ panel) */
export function useResultStore(): ResultStore {
  const [store, setStore] = useState(readStore)
  useEffect(() => {
    const refresh = () => setStore(readStore())
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === KEY) refresh()
    }
    refresh()
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener("storage", onStorage)
    }
  }, [])
  return store
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

/** Fichas sin perfil en los datos de ejemplo: el turno se infiere de la hora de finalización */
function unknownWorkerRow(latest: StoredResult): Evaluation {
  const hour = new Date(latest.completedAt).getHours()
  return {
    id: latest.fichaId,
    name: "Trabajador sin registro",
    rut: "—",
    role: "Sin registro",
    company: "Sin empresa",
    shift: hour >= 7 && hour < 19 ? "Día" : "Noche",
    score: latest.score,
    time: formatCompletedTime(latest.completedAt),
    status: latest.status,
  }
}

/**
 * Lista del panel: perfil de ejemplo + último resultado real de cada ficha.
 * Las fichas con resultado real que no están en los datos de ejemplo se agregan al final.
 */
export function mergeEvaluations(base: readonly Evaluation[], store: ResultStore): Evaluation[] {
  const withLatest = (row: Evaluation): Evaluation => {
    const list = store[row.id]
    const latest = list?.[list.length - 1]
    if (!latest) return row
    return {
      ...row,
      score: latest.score,
      status: latest.status,
      time: formatCompletedTime(latest.completedAt),
      completedAt: latest.completedAt,
      breakdown: breakdownFromResult(latest.breakdown),
      live: true,
    }
  }
  const known = new Set(base.map((e) => e.id))
  const extra = Object.keys(store)
    .filter((id) => !known.has(id) && store[id]!.length > 0)
    .map((id) => unknownWorkerRow(store[id]![store[id]!.length - 1]!))
    .sort((a, b) => a.id.localeCompare(b.id))
  return [...base, ...extra].map(withLatest)
}

/** Evaluaciones del turno para el panel de supervisión, siempre con el último resultado */
export function useEvaluations(): Evaluation[] {
  const store = useResultStore()
  return useMemo(() => mergeEvaluations(EVALUATIONS, store), [store])
}
