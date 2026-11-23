import type { Status } from "./data"

// Descanso preventivo tras SEMI APTO (5 min desde que el resultado LLEGA al servidor, la misma
// hora con que lo mide la base; ver D10). NO APTO no lleva temporizador: el segundo intento lo
// decide el supervisor. La regla la aplica también la base de datos al abrir un nuevo test.
export const BLOCK_MS = 5 * 60 * 1000

/** Hasta cuándo rige el descanso de un resultado SEMI APTO (null si no aplica o ya terminó) */
export function semiBlockUntil(
  result: { status: Status; completedAt: number; receivedAt?: number },
  now = Date.now(),
): number | null {
  if (result.status !== "semi") return null
  const until = (result.receivedAt ?? result.completedAt) + BLOCK_MS
  return until > now ? until : null
}
