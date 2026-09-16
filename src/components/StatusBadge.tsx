import { STATUS_META, type Status } from "../lib/data"

export default function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider ${m.bg} ${m.border} ${m.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.short}
    </span>
  )
}
