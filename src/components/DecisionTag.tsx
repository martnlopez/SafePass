import { STATUS_META } from "../lib/data"
import { decisionOption, formatDecisionTime, retestAvailableAt, type SupervisorDecision } from "../lib/decisions"

// Decisión vigente de un caso en el panel: qué se decidió y si el trabajador ya la vio.
export default function DecisionTag({
  decision,
  className = "",
}: {
  decision: SupervisorDecision | null | undefined
  className?: string
}) {
  if (!decision) return null
  const option = decisionOption(decision.decision)
  const tone = STATUS_META[option.tone]
  const seen = decision.consumedAt ?? decision.seenAt
  const availableAt = decision.consumedAt === null ? retestAvailableAt(decision) : null

  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] uppercase tracking-wider ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      <span className={`font-700 ${tone.text}`}>{option.short}</span>
      {!decision.decidedBy && <span className="text-[color:var(--color-fog)]">· auto</span>}
      {availableAt !== null && <span className="text-[color:var(--color-fog)]">· desde {formatDecisionTime(availableAt)}</span>}
      <span className="text-[color:var(--color-fog)]">
        · {seen ? `visto ${formatDecisionTime(seen)}` : "sin ver"}
      </span>
    </p>
  )
}
