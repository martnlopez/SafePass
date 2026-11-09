import { scoreToStatus, SCORE_BANDS, STATUS_META } from "../lib/data"

// Escala continua 0-100 con los tres tramos de aptitud y marcador del puntaje.
export default function ScoreScale({ score, className = "fade-up mt-7" }: { score: number; className?: string }) {
  const pos = Math.max(0, Math.min(100, score))
  const m = STATUS_META[scoreToStatus(score)]

  return (
    <div className={`${className} rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-5`}>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Escala de aptitud
        </p>
        <p className={`font-mono text-2xl font-800 tabular-nums ${m.text}`}>
          {score} <span className="text-sm font-700">pts</span>
        </p>
      </div>
      <div className="relative mt-4 flex h-2.5 gap-0.5">
        {SCORE_BANDS.map((b) => (
          <div
            key={b.status}
            className={`h-full rounded-full ${STATUS_META[b.status].dot} opacity-40`}
            style={{ width: `${b.to - b.from + 1}%` }}
          />
        ))}
        <div
          className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 -translate-x-1/2 rounded-full border-[3px] border-[color:var(--color-ink)] ${m.dot}`}
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-[59fr_20fr_21fr] gap-0.5 font-mono text-[10px] leading-tight">
        {SCORE_BANDS.map((b) => {
          const bm = STATUS_META[b.status]
          const active = b.status === scoreToStatus(score)
          return (
            <div key={b.status} className={active ? bm.text : "text-[color:var(--color-fog)]"}>
              <p className="font-700">{b.from}–{b.to}</p>
              <p className="uppercase tracking-wider">{bm.short}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
