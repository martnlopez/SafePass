import { useMemo, useState } from "react"
import { buildBreakdown, scoreToZ, STATUS_META, type Evaluation } from "../lib/data"

const DECISIONS = [
  {
    id: "retest",
    label: "Autorizar Re-test",
    sub: "Tras 15 min de descanso e hidratación",
  },
  {
    id: "reasignar",
    label: "Reasignación de Tarea",
    sub: "Rol de bajo riesgo / taller",
  },
  {
    id: "policlinico",
    label: "Derivación a Policlínico / Mutual",
    sub: "Evaluación médica presencial",
  },
  {
    id: "suspender",
    label: "Restablecimiento / Suspensión de Turno",
    sub: "Retiro de faena por seguridad",
  },
] as const

export default function ManageModal({
  evaluation,
  onClose,
}: {
  evaluation: Evaluation
  onClose: () => void
}) {
  const [decision, setDecision] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [saved, setSaved] = useState(false)
  const m = STATUS_META[evaluation.status]
  const breakdown = useMemo(() => buildBreakdown(evaluation), [evaluation])
  const z = scoreToZ(evaluation.score)
  const isCritical = evaluation.status === "no"

  function confirm() {
    if (!decision) return
    setSaved(true)
    setTimeout(onClose, 1500)
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-end sm:place-items-center bg-black/70 p-0 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        className="scale-in flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`border-b border-[color:var(--color-slate-line)] p-6 ${m.bg}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                {isCritical && <span className="alert-pulse h-2.5 w-2.5 rounded-full bg-[color:var(--color-no)]" />}
                <span className={`font-mono text-[11px] font-700 uppercase tracking-[0.2em] ${m.text}`}>
                  {isCritical ? "Alerta · " : "Detalle · "}
                  {m.short}
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-800 tracking-tight">{evaluation.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-[color:var(--color-fog)]">
                <span className="font-700 text-[color:var(--color-mist)]">{evaluation.id}</span>
                <span>{evaluation.role}</span>
                <span>Turno {evaluation.shift}</span>
                <span>{evaluation.time} hrs</span>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-mono text-4xl font-800 tabular-nums ${m.text}`}>{evaluation.score}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-fog)]">/ 100 pts</p>
              <p className={`mt-1 font-mono text-xs font-700 ${m.text}`}>
                Z {z > 0 ? "+" : ""}
                {z.toFixed(1)} σ
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          {/* Ficha técnica · últimos 5 tests */}
          <section>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Ficha técnica · últimos 5 tests
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {breakdown.map((f, i) => {
                const fm = STATUS_META[f.severity]
                return (
                  <div key={i} className={`rounded-xl border p-3 ${fm.border} ${fm.bg}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase leading-tight tracking-wider text-[color:var(--color-fog)]">
                        {f.test}
                      </p>
                      <span className={`font-mono text-sm font-800 tabular-nums ${fm.text}`}>{f.score}</span>
                    </div>
                    <p className={`mt-2 font-mono text-sm font-700 ${fm.text}`}>{f.value}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[color:var(--color-fog)]">{f.threshold}</p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Decisiones */}
          <section className="mt-6">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Toma de decisiones
            </h3>
            <div className="mt-3 space-y-2.5">
              {DECISIONS.map((d) => {
                const active = decision === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => setDecision(d.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? "border-[color:var(--color-semi)] bg-[color:var(--color-semi)]/10"
                        : "border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] hover:border-[color:var(--color-fog)]"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                        active ? "border-[color:var(--color-semi)]" : "border-[color:var(--color-slate-line)]"
                      }`}
                    >
                      {active && <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--color-semi)]" />}
                    </span>
                    <span className="leading-tight">
                      <span className="block text-sm font-700 text-[color:var(--color-mist)]">{d.label}</span>
                      <span className="block font-mono text-[11px] text-[color:var(--color-fog)]">{d.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Observaciones */}
          <section className="mt-6">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
                Observaciones del supervisor
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Registra el contexto de la decisión, síntomas observados o acuerdos con el trabajador…"
                className="mt-2 w-full resize-none rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] px-4 py-3 text-sm outline-none transition-colors placeholder:text-[color:var(--color-fog)]/40 focus:border-[color:var(--color-semi)]"
              />
            </label>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)]/40 p-5">
          <button
            onClick={onClose}
            className="h-14 flex-1 rounded-xl border border-[color:var(--color-slate-line)] font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:bg-[color:var(--color-steel-2)]"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={!decision || saved}
            className="h-14 flex-[1.6] rounded-xl bg-[color:var(--color-semi)] font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[color:var(--color-steel-2)] disabled:text-[color:var(--color-fog)]"
          >
            {saved ? "✓ Medida registrada" : "Confirmar y registrar medida"}
          </button>
        </div>
      </div>
    </div>
  )
}
