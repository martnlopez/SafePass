import { useState } from "react"
import { useCountdown } from "../lib/useCountdown"
import { scoreToStatus, STATUS_META, type BatteryResult } from "../lib/data"
import { BLOCK_MS } from "../lib/block"
import { issueAccessPass, type AccessPass } from "../lib/pass"
import { formatCompletedTime } from "../lib/results"
import AccessPassCard from "./AccessPassCard"
import ScoreScale from "./ScoreScale"

// Bloqueo de reintento: cuenta regresiva de 5 min (300 s) solo para SEMI APTO
// (descanso preventivo). Impide volver a rendir de inmediato.
function RetryButton({ blockUntil, onRetry }: { blockUntil: number; onRetry: () => void }) {
  const { left, clock } = useCountdown(blockUntil)
  const ready = left <= 0

  return (
    <button
      // Guard: sin handler mientras corre el temporizador — el tap no hace nada
      onClick={ready ? onRetry : undefined}
      disabled={!ready}
      className={
        ready
          ? "h-16 w-full rounded-xl bg-[color:var(--color-semi)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99]"
          : "h-16 w-full cursor-not-allowed rounded-xl bg-[color:var(--color-steel)] font-mono text-base font-700 uppercase tracking-wide text-[color:var(--color-fog)] opacity-50"
      }
    >
      {ready ? "Reintentar evaluación" : `Esperar para reintentar (${clock} min)`}
    </button>
  )
}

function RestCountdown({ blockUntil }: { blockUntil: number }) {
  const { left, clock } = useCountdown(blockUntil)
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-[color:var(--color-semi)]/30 bg-[color:var(--color-semi)]/10 px-4 py-3">
      <span className="font-mono text-2xl font-800 tabular-nums text-[color:var(--color-semi)]">{clock}</span>
      <span className="font-mono text-[11px] uppercase leading-tight tracking-wider text-[color:var(--color-fog)]">
        {left > 0 ? (
          <>Descanso preventivo<br />antes del re-test</>
        ) : (
          <>Descanso cumplido<br />ya puedes reintentar</>
        )}
      </span>
    </div>
  )
}

export default function TestResults({
  result,
  onRetry,
  onDone,
  saveError = null,
  initialPass = null,
  onResend,
}: {
  /** Reenvía el mismo resultado si el guardado falló por la red (sin repetir el test) */
  onResend?: () => void
  result: BatteryResult
  onRetry: () => void
  onDone: () => void
  /** Error al guardar el resultado en el servidor (null = guardado) */
  saveError?: string | null
  /** Pase ya emitido (al volver a iniciar sesión con un APTO vigente) */
  initialPass?: AccessPass | null
}) {
  const { score, breakdown, fichaId } = result
  const status = scoreToStatus(score)
  const m = STATUS_META[status]
  const [pass, setPass] = useState<AccessPass | null>(initialPass)
  const [passBusy, setPassBusy] = useState(false)
  const [passError, setPassError] = useState<string | null>(null)
  // Temporizador solo en SEMI APTO (5 min desde la hora de finalización que fija el servidor).
  // NO APTO queda a criterio del supervisor: la base registra la "Revisión pendiente".
  const completedAt = result.completedAt ?? Date.now()
  const blockUntil = status === "semi" ? completedAt + BLOCK_MS : 0
  const finishedAt = formatCompletedTime(completedAt)

  async function generatePass() {
    setPassBusy(true)
    setPassError(null)
    try {
      setPass(await issueAccessPass())
    } catch (err) {
      setPassError((err as Error).message)
    } finally {
      setPassBusy(false)
    }
  }

  const stateLabel =
    status === "apto" ? "APTO" : status === "semi" ? "ZONA CRÍTICA · RE-TEST" : "NO APTO"

  return (
    <div className="min-h-screen w-full bg-[color:var(--color-ink)]">
      {/* Mobile: columna única · Desktop: dos columnas horizontales */}
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10
                      lg:max-w-5xl lg:flex-row lg:items-start lg:gap-8 lg:px-12 lg:py-12">

        {/* ── Columna izquierda: score + gauge + estado + acción ── */}
        <div className="flex flex-col lg:w-[44%] lg:shrink-0 lg:sticky lg:top-12">

          {/* Top bar */}
          <div className="fade-up flex items-center justify-between">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-fog)]">
              Evaluación completa · {finishedAt}
            </p>
            <p className="font-mono text-xs font-700 text-[color:var(--color-mist)]">{fichaId}</p>
          </div>

          {/* Score circle */}
          <div className="scale-in mt-8 text-center">
            <div className={`mx-auto flex h-44 w-44 flex-col items-center justify-center rounded-full border-4 ${m.border} ${m.bg}`}>
              <span className={`font-mono text-6xl font-800 tabular-nums ${m.text}`}>{score}</span>
              <span className="font-mono text-xs uppercase tracking-widest text-[color:var(--color-fog)]">
                Score global / 100
              </span>
            </div>
          </div>

          {/* Escala continua 0-100 */}
          <ScoreScale score={score} />

          {/* Status banner */}
          <div className={`fade-up mt-5 rounded-2xl border p-5 text-center ${m.border} ${m.bg}`}>
            <div className="flex items-center justify-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
              <p className={`text-lg font-800 leading-tight tracking-tight ${m.text}`}>{stateLabel}</p>
            </div>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
              {m.label}
            </p>
            <p className={`mt-2 font-mono text-[11px] font-700 uppercase tracking-wider ${m.text}`}>
              {m.range} · {m.band}
            </p>
          </div>

          {saveError && (
            <div role="alert" className="mt-5 rounded-xl border border-[color:var(--color-no)]/40 bg-[color:var(--color-no)]/10 px-4 py-3 text-sm text-[color:var(--color-mist)]">
              <p>
                <span className="font-700 text-[color:var(--color-no)]">No se pudo guardar el resultado.</span> {saveError}{" "}
                {onResend ? "Tu resultado sigue guardado en este equipo: reintenta el envío cuando haya señal." : "Avisa a tu supervisor."}
              </p>
              {onResend && (
                <button
                  onClick={onResend}
                  className="mt-3 h-12 w-full rounded-lg border border-[color:var(--color-no)] font-700 uppercase tracking-wide text-white transition-colors hover:bg-[color:var(--color-no)]/20"
                >
                  Reintentar envío
                </button>
              )}
            </div>
          )}

          {/* Action button */}
          <div className="fade-up mt-6" style={{ animationDelay: "120ms" }}>
            {status === "apto" && (
              <>
                <button
                  onClick={pass ? onDone : () => void generatePass()}
                  disabled={passBusy || (!pass && saveError !== null)}
                  className="h-16 w-full rounded-xl bg-[color:var(--color-apt)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-apt-dim)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pass ? "Finalizar y salir" : passBusy ? "Generando pase…" : "Generar pase / QR de acceso"}
                </button>
                {passError && (
                  <p role="alert" className="mt-3 text-center font-mono text-xs text-[color:var(--color-no)]">
                    {passError}
                  </p>
                )}
              </>
            )}
            {/* SEMI APTO: reintento bloqueado 5 min (descanso preventivo) + salida secundaria */}
            {status === "semi" && (
              <>
                <RetryButton blockUntil={blockUntil} onRetry={onRetry} />
                <button
                  onClick={onDone}
                  className="mt-3 h-14 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-sm font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-all hover:border-[color:var(--color-no)] hover:text-white active:scale-[0.99]"
                >
                  Finalizar y notificar a supervisor
                </button>
              </>
            )}
            {/* NO APTO: sin temporizador ni reintento propio — el segundo intento o pase
                lo decide el supervisor desde su panel. Ya se notifica en automático. */}
            {status === "no" && (
              <button
                onClick={onDone}
                className="h-16 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-mist)] transition-all hover:border-[color:var(--color-no)] hover:text-white active:scale-[0.99]"
              >
                Cerrar y salir
              </button>
            )}
          </div>
        </div>

        {/* ── Columna derecha: desglose por prueba + bloque de estado ── */}
        <div className="mt-6 flex flex-1 flex-col gap-4 lg:mt-[3.75rem]">

          {/* Per-test breakdown */}
          <div className="fade-up space-y-2" style={{ animationDelay: "60ms" }}>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Desglose por prueba
            </p>
            {breakdown.map((b) => {
              const st = scoreToStatus(b.score)
              const bm = STATUS_META[st]
              return (
                <div
                  key={b.key}
                  className="flex items-center gap-3 rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-3"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${bm.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-600 text-[color:var(--color-mist)]">{b.name}</p>
                    <p className="truncate font-mono text-[11px] text-[color:var(--color-fog)]">{b.detail}</p>
                  </div>
                  <span className={`font-mono text-lg font-800 tabular-nums ${bm.text}`}>{b.score}</span>
                </div>
              )
            })}
          </div>

          {/* State-specific block */}
          <div className="fade-up mt-2" style={{ animationDelay: "80ms" }}>
            {status === "apto" && (
              <div className="flex flex-col items-center rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
                  Pase de acceso a faena
                </p>
                <div className="mt-4">
                  <AccessPassCard pass={pass} fichaId={fichaId} accentHex={m.hex} />
                </div>
              </div>
            )}
            {status === "semi" && (
              <div className="rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6">
                <p className="text-sm leading-relaxed text-[color:var(--color-mist)]">
                  Tu desempeño está en zona crítica. Descansa, hidrátate y vuelve a rendir la evaluación
                  antes de tu ingreso.
                </p>
                <RestCountdown blockUntil={blockUntil} />
              </div>
            )}
            {status === "no" && (
              <div className="rounded-2xl border border-[color:var(--color-no)]/30 bg-[color:var(--color-no)]/8 p-6">
                <p className="text-base font-700 leading-relaxed text-[color:var(--color-mist)]">
                  Por seguridad, no estás autorizado para ingresar en este turno.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-fog)]">
                  Dirígete con tu supervisor de turno: la autorización de un segundo intento o de tu pase de
                  acceso depende de su decisión. Al volver a ingresar tu Ficha ID verás su respuesta.
                </p>
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-[color:var(--color-no)]/30 bg-[color:var(--color-no)]/10 px-4 py-3">
                  <span className="alert-pulse h-3 w-3 rounded-full bg-[color:var(--color-no)]" />
                  <span className="font-mono text-xs uppercase tracking-wider text-[color:var(--color-no)]">
                    Alerta enviada a supervisión
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
