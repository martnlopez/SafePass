import { scoreToStatus, type BatteryResult } from "./data"

// Bloqueo de reintento (solo SEMI APTO · descanso preventivo): persistido por
// Ficha ID con un timestamp absoluto, de modo que sobrevive a cerrar sesión /
// recargar. NO APTO no lleva temporizador: el segundo intento lo decide el
// supervisor desde su panel.
export const BLOCK_MS = 5 * 60 * 1000

interface StoredBlock {
  blockUntil: number
  result: BatteryResult
}

const key = (fichaId: string) => `safepass:block:${fichaId.toUpperCase()}`

function read(fichaId: string): StoredBlock | null {
  try {
    const raw = localStorage.getItem(key(fichaId))
    return raw ? (JSON.parse(raw) as StoredBlock) : null
  } catch {
    return null
  }
}

export function getActiveBlock(fichaId: string): StoredBlock | null {
  const b = read(fichaId)
  if (!b) return null
  // Descarta bloqueos antiguos que no correspondan a SEMI APTO
  if (b.blockUntil <= Date.now() || scoreToStatus(b.result.score) !== "semi") {
    clearBlock(fichaId)
    return null
  }
  return b
}

export function startBlock(fichaId: string, result: BatteryResult): number {
  const existing = getActiveBlock(fichaId)
  if (existing) return existing.blockUntil
  const blockUntil = Date.now() + BLOCK_MS
  try {
    localStorage.setItem(key(fichaId), JSON.stringify({ blockUntil, result }))
  } catch {
    // sin storage: el bloqueo vive solo en memoria de la sesión
  }
  return blockUntil
}

export function clearBlock(fichaId: string) {
  try {
    localStorage.removeItem(key(fichaId))
  } catch {
    // noop
  }
}
