import { useMemo, useState } from "react"
import { buildBreakdown, STATUS_META, type Evaluation } from "../lib/data"
import {
  DECISIONS,
  decisionOption,
  formatDecisionTime,
  isDecisionCurrent,
  NOTE_MAX_LENGTH,
  retestAvailableAt,
  saveDecision,
  type DecisionId,
  type SupervisorDecision,
} from "../lib/decisions"
import { formatCompletedTime } from "../lib/results"
import ScoreScale from "./ScoreScale"

export default function ManageModal({
  evaluation,
  current: initialCurrent,
  onClose,
}: {
  evaluation: Evaluation
  /** Última decisión registrada para este trabajador (null si no hay) */
  current: SupervisorDecision | null
  onClose: () => void
}) {
  // Decisión vigente del caso (la que ve el trabajador): solo referencia. El formulario
  // parte vacío y se limpia al notificar, para que cada medida lleve su propio comentario.
  const [current, setCurrent] = useState(initialCurrent)
  const [decision, setDecision] = useState<DecisionId | null>(null)
  const [notes, setNotes] = useState("")
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const m = STATUS_META[evaluation.status]
  // Desglose real si la ficha rindió en la app; si no, el de los datos de ejemplo
  // Sin desglose registrado se muestran cifras estimadas, marcadas como tales (no son mediciones)
  const estimated = !evaluation.breakdown
  const breakdown = useMemo(() => evaluation.breakdown ?? buildBreakdown(evaluation), [evaluation])
  const currentIsActive = current !== null && isDecisionCurrent(current, evaluation.completedAt)
  const isCritical = evaluation.status === "no"

  async function confirm() {
    if (!decision || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      // El servidor registra autor, hora y resultado de referencia
      const record = await saveDecision({ workerId: evaluation.workerId, decision, note: notes })
      setCurrent(record)
      setDecision(null)
      setNotes("")
      setSaved(true)
      setTimeout(onClose, 1500)
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
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
                <span title={evaluation.completedAt ? new Date(evaluation.completedAt).toLocaleString("es-CL") : undefined}>
                  {evaluation.completedAt ? formatCompletedTime(evaluation.completedAt, true) : evaluation.time} hrs
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-mono text-4xl font-800 tabular-nums ${m.text}`}>{evaluation.score}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-fog)]">/ 100 pts</p>
              <p className={`mt-1 font-mono text-xs font-700 uppercase tracking-wider ${m.text}`}>{m.short}</p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          {/* Misma escala 0-100 y tramos que ve el trabajador */}
          <ScoreScale score={evaluation.score} className="" />
          <p className={`mt-2 text-center font-mono text-[11px] font-700 uppercase tracking-wider ${m.text}`}>
            {m.range} · {m.band}
          </p>

          {/* Ficha técnica · últimos 5 tests */}
          <section className="mt-6">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              Ficha técnica · últimos 5 tests
            </h3>
            {estimated && (
              <p className="mt-2 text-xs text-[color:var(--color-semi)]">
                Estimado: esta evaluación no tiene desglose registrado. Las cifras se derivan del puntaje global y no son mediciones.
              </p>
            )}
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
            {current && (
              <div className="mt-2 rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] px-3 py-2 font-mono text-[11px] text-[color:var(--color-fog)]">
                <p>
                  {currentIsActive ? "Vigente: " : "Última decisión (anterior a la evaluación más reciente): "}
                  <span className="font-700 text-[color:var(--color-mist)]">{decisionOption(current.decision).short}</span>
                  {" · "}
                  {current.decidedBy ? `por ${current.decidedBy}` : "automática (NO APTO)"} · {formatDecisionTime(current.decidedAt)}
                  {retestAvailableAt(current) !== null && ` · re-test habilitado desde ${formatDecisionTime(retestAvailableAt(current)!)}`}
                  {current.seenAt && ` · vista por el trabajador ${formatDecisionTime(current.seenAt)}`}
                </p>
                {current.note && <p className="mt-1 normal-case text-[color:var(--color-mist)]">Comentario enviado: “{current.note}”</p>}
              </div>
            )}
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
                maxLength={NOTE_MAX_LENGTH}
                placeholder="Ej.: Autorizado tras pausa de hidratación de 15 minutos."
                className="mt-2 w-full resize-none rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] px-4 py-3 text-sm outline-none transition-colors placeholder:text-[color:var(--color-fog)]/40 focus:border-[color:var(--color-semi)]"
              />
            </label>
            <div className="mt-1.5 flex items-start justify-between gap-4 font-mono text-[11px] text-[color:var(--color-fog)]">
              <span>El trabajador lo verá junto a la decisión al ingresar con su Ficha ID. No incluyas diagnósticos ni datos médicos.</span>
              <span className="shrink-0 tabular-nums">
                {notes.length}/{NOTE_MAX_LENGTH}
              </span>
            </div>
          </section>
        </div>

        {saveError && (
          <p role="alert" className="border-t border-[color:var(--color-no)]/40 bg-[color:var(--color-no)]/10 px-5 py-3 text-sm text-[color:var(--color-mist)]">
            No se pudo registrar la medida: {saveError}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)]/40 p-5">
          <button
            onClick={onClose}
            className="h-14 flex-1 rounded-xl border border-[color:var(--color-slate-line)] font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:bg-[color:var(--color-steel-2)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!decision || saved || saving}
            className="h-14 flex-[1.6] rounded-xl bg-[color:var(--color-semi)] font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[color:var(--color-steel-2)] disabled:text-[color:var(--color-fog)]"
          >
            {saved ? "✓ Medida registrada y notificada" : saving ? "Registrando…" : "Confirmar y registrar medida"}
          </button>
        </div>
      </div>
    </div>
  )
}
