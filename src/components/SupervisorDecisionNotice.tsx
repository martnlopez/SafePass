import { useEffect, useState } from "react"
import { STATUS_META } from "../lib/data"
import {
  decisionOption,
  formatDecisionTime,
  markDecisionConsumed,
  markDecisionSeen,
  retestAvailableAt,
  RETEST_REST_MINUTES,
  type SupervisorDecision,
} from "../lib/decisions"
import { createAccessPass, registerPass, type AccessPass } from "../lib/pass"
import { useCountdown } from "../lib/useCountdown"
import AccessPassCard from "./AccessPassCard"

// Tarjeta que el trabajador ve al ingresar su Ficha ID cuando hay una decisión
// del supervisor sobre su último resultado. Se muestra ANTES de poder iniciar o
// retomar la evaluación; las decisiones de bloqueo no permiten continuar y el
// re-test autorizado espera el descanso indicado por el supervisor.
export default function SupervisorDecisionNotice({
  decision,
  onStartTest,
  onExit,
}: {
  decision: SupervisorDecision
  onStartTest: () => void
  onExit: () => void
}) {
  const option = decisionOption(decision.decision)
  const tone = STATUS_META[option.tone]
  const resultMeta = STATUS_META[decision.evaluation.status]
  const [pass, setPass] = useState<AccessPass | null>(null)

  useEffect(() => {
    markDecisionSeen(decision.fichaId)
  }, [decision.fichaId])

  function startTest() {
    markDecisionConsumed(decision.fichaId)
    onStartTest()
  }

  function issuePass() {
    const p = createAccessPass(decision.fichaId)
    registerPass(p)
    markDecisionConsumed(decision.fichaId)
    setPass(p)
  }

  const primary =
    "h-16 w-full rounded-xl text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all active:scale-[0.99]"
  const secondary =
    "h-14 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-sm font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-all hover:border-[color:var(--color-fog)] hover:text-white active:scale-[0.99]"

  return (
    <div className="min-h-screen w-full bg-[color:var(--color-ink)]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10 lg:max-w-2xl lg:px-12">
        {/* Top bar */}
        <div className="fade-up flex items-center justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-fog)]">
            Decisión del supervisor
          </p>
          <p className="font-mono text-xs font-700 text-[color:var(--color-mist)]">{decision.fichaId}</p>
        </div>

        {/* Decisión oficial */}
        <div role="alert" className={`scale-in mt-6 rounded-2xl border p-6 ${tone.border} ${tone.bg}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot} ${option.effect === "block" ? "alert-pulse" : ""}`} />
            <p className={`font-mono text-[11px] font-700 uppercase tracking-[0.2em] ${tone.text}`}>
              {option.effect === "block" ? "Acción requerida" : "Autorización"}
            </p>
          </div>
          <h1 className="mt-3 text-3xl font-800 leading-tight tracking-tight text-white">{option.workerTitle}</h1>
          <p className="mt-3 text-base leading-relaxed text-[color:var(--color-mist)]">{option.workerMessage}</p>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
            <span>
              Resultado revisado:{" "}
              <span className={`font-700 ${resultMeta.text}`}>
                {decision.evaluation.score} pts · {resultMeta.short}
              </span>
            </span>
            <span>
              {decision.decidedBy ? `Supervisor ${decision.decidedBy}` : "Registro automático"} ·{" "}
              {formatDecisionTime(decision.decidedAt)}
            </span>
          </div>
        </div>

        {/* Comentario del supervisor */}
        {decision.note && (
          <figure className="fade-up mt-4 rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-5">
            <figcaption className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Comentario del supervisor
            </figcaption>
            <blockquote className="mt-2 border-l-2 border-[color:var(--color-semi)] pl-4 text-base leading-relaxed text-white">
              “{decision.note}”
            </blockquote>
          </figure>
        )}

        {/* Pase excepcional emitido */}
        {pass && (
          <div className="fade-up mt-4 flex flex-col items-center rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Pase de acceso a faena · excepcional
            </p>
            <div className="mt-4">
              <AccessPassCard pass={pass} fichaId={decision.fichaId} accentHex={tone.hex} />
            </div>
          </div>
        )}

        {/* Acciones según el efecto de la decisión */}
        <div className="fade-up mt-6 space-y-3" style={{ animationDelay: "120ms" }}>
          {option.effect === "retest" && (
            <>
              <RetestGate availableAt={retestAvailableAt(decision) ?? 0} onStart={startTest} primary={primary} />
              <button onClick={onExit} className={secondary}>
                Cerrar sesión
              </button>
            </>
          )}
          {option.effect === "pass" &&
            (pass ? (
              <button onClick={onExit} className={`${primary} bg-[color:var(--color-apt)] hover:bg-[color:var(--color-apt-dim)]`}>
                Finalizar y cerrar sesión
              </button>
            ) : (
              <>
                <button onClick={issuePass} className={`${primary} bg-[color:var(--color-apt)] hover:bg-[color:var(--color-apt-dim)]`}>
                  Generar pase / QR de acceso
                </button>
                <button onClick={onExit} className={secondary}>
                  Cerrar sesión
                </button>
              </>
            ))}
          {option.effect === "block" && (
            <>
              <button onClick={onExit} className={`${secondary} h-16 text-lg`}>
                Cerrar sesión
              </button>
              <p className="text-center font-mono text-[11px] text-[color:var(--color-fog)]">
                No puedes rendir la evaluación hasta que tu supervisor registre una nueva indicación.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Re-test autorizado: descanso obligatorio con cuenta regresiva antes de habilitar la evaluación */
function RetestGate({ availableAt, onStart, primary }: { availableAt: number; onStart: () => void; primary: string }) {
  const { left, clock } = useCountdown(availableAt)
  const ready = left <= 0

  return (
    <>
      <div
        className={`flex items-center gap-4 rounded-xl border px-5 py-4 ${
          ready
            ? "border-[color:var(--color-apt)]/30 bg-[color:var(--color-apt)]/10"
            : "border-[color:var(--color-semi)]/30 bg-[color:var(--color-semi)]/10"
        }`}
      >
        <span
          className={`font-mono text-3xl font-800 tabular-nums ${
            ready ? "text-[color:var(--color-apt)]" : "text-[color:var(--color-semi)]"
          }`}
        >
          {clock}
        </span>
        <span className="font-mono text-[11px] uppercase leading-tight tracking-wider text-[color:var(--color-fog)]">
          {ready ? (
            <>Descanso cumplido<br />ya puedes comenzar</>
          ) : (
            <>Descanso indicado por tu supervisor<br />({RETEST_REST_MINUTES} min) antes del re-test</>
          )}
        </span>
      </div>
      <button
        onClick={ready ? onStart : undefined}
        disabled={!ready}
        className={
          ready
            ? `${primary} bg-[color:var(--color-semi)] hover:bg-[color:var(--color-semi-dim)]`
            : "h-16 w-full cursor-not-allowed rounded-xl bg-[color:var(--color-steel)] font-mono text-base font-700 uppercase tracking-wide text-[color:var(--color-fog)] opacity-50"
        }
      >
        {ready ? "Continuar a la evaluación" : `Disponible en ${clock} min`}
      </button>
    </>
  )
}
