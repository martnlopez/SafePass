import { useEffect, useState } from "react"
import { scoreToStatus, STATUS_META, type BatteryResult } from "../lib/data"

// Bloqueo de reintento: cuenta regresiva de 5 min (300 s) para estados
// SEMI APTO / NO APTO. Impide reevaluación inmediata frente al tótem.
function RetryButton({ onRetry }: { onRetry: () => void }) {
  const WAIT = 300
  const [left, setLeft] = useState(WAIT)

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  const ready = left <= 0
  const mm = String(Math.floor(left / 60)).padStart(2, "0")
  const ss = String(left % 60).padStart(2, "0")

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
      {ready ? "Reintentar evaluación" : `Esperar para reintentar (${mm}:${ss} min)`}
    </button>
  )
}

function QrGlyph({ color }: { color: string }) {
  const cells = 11
  const seed = [
    0x7f, 0x41, 0x5d, 0x5d, 0x41, 0x7f, 0x2a, 0x6b, 0x1c, 0x3e, 0x55, 0x22, 0x49, 0x6e, 0x13, 0x7c,
    0x2d, 0x58, 0x64, 0x0f, 0x76,
  ]
  return (
    <div
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${cells}, 1fr)`, width: 168, height: 168 }}
    >
      {Array.from({ length: cells * cells }).map((_, i) => {
        const on = (seed[i % seed.length] >> i % 7) & 1
        return <div key={i} className="rounded-[2px]" style={{ background: on ? color : "transparent" }} />
      })}
    </div>
  )
}

export default function TestResults({
  result,
  onRetry,
  onDone,
}: {
  result: BatteryResult
  onRetry: () => void
  onDone: () => void
}) {
  const { score, z, breakdown, fichaId } = result
  const status = scoreToStatus(score)
  const m = STATUS_META[status]
  const now = new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })

  const zPct = Math.max(0, Math.min(100, ((z + 3) / 6) * 100))
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
              Evaluación completa · {now}
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

          {/* Z-Score gauge */}
          <div className="fade-up mt-7 rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-5">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
                Z-Score (vs. baseline)
              </p>
              <p className={`font-mono text-2xl font-800 tabular-nums ${m.text}`}>
                {z > 0 ? "+" : ""}{z.toFixed(1)} σ
              </p>
            </div>
            <div className="relative mt-4 h-2 rounded-full bg-[color:var(--color-ink)]">
              <div
                className="absolute inset-y-0 rounded-full bg-[color:var(--color-apt)]/20"
                style={{ left: `${((-1.5 + 3) / 6) * 100}%`, right: 0 }}
              />
              <div
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-[color:var(--color-ink)] ${m.dot}`}
                style={{ left: `${zPct}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-[color:var(--color-fog)]">
              <span>-3σ</span>
              <span>umbral -1.5σ</span>
              <span>+3σ</span>
            </div>
          </div>

          {/* Status banner */}
          <div className={`fade-up mt-5 rounded-2xl border p-5 text-center ${m.border} ${m.bg}`}>
            <div className="flex items-center justify-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
              <p className={`text-lg font-800 leading-tight tracking-tight ${m.text}`}>{stateLabel}</p>
            </div>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
              {m.label}
            </p>
          </div>

          {/* Action button */}
          <div className="fade-up mt-6" style={{ animationDelay: "120ms" }}>
            {status === "apto" && (
              <button
                onClick={onDone}
                className="h-16 w-full rounded-xl bg-[color:var(--color-apt)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-apt-dim)] active:scale-[0.99]"
              >
                Generar pase / QR de acceso
              </button>
            )}
            {/* SEMI/NO APTO: reintento bloqueado 5 min + salida secundaria */}
            {(status === "semi" || status === "no") && (
              <>
                <RetryButton onRetry={onRetry} />
                {/* NO APTO ya se notifica en automático → salida solo cierra la sesión y reinicia el tótem */}
                <button
                  onClick={onDone}
                  className="mt-3 h-14 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-sm font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-all hover:border-[color:var(--color-no)] hover:text-white active:scale-[0.99]"
                >
                  {status === "no" ? "Cerrar y salir" : "Finalizar y notificar a supervisor"}
                </button>
              </>
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
                <div className="mt-4 rounded-xl bg-[color:var(--color-ink)] p-4">
                  <QrGlyph color={m.hex} />
                </div>
                <p className="mt-4 font-mono text-sm font-600 text-[color:var(--color-mist)]">
                  PASE-{fichaId} · Válido 12 h
                </p>
              </div>
            )}
            {status === "semi" && (
              <div className="rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6">
                <p className="text-sm leading-relaxed text-[color:var(--color-mist)]">
                  Tu desempeño está en zona crítica. Descansa, hidrátate y vuelve a rendir la evaluación
                  antes de tu ingreso.
                </p>
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-[color:var(--color-semi)]/30 bg-[color:var(--color-semi)]/10 px-4 py-3">
                  <span className="font-mono text-2xl font-800 text-[color:var(--color-semi)]">05:00</span>
                  <span className="font-mono text-[11px] uppercase leading-tight tracking-wider text-[color:var(--color-fog)]">
                    Tiempo mínimo<br />de espera
                  </span>
                </div>
              </div>
            )}
            {status === "no" && (
              <div className="rounded-2xl border border-[color:var(--color-no)]/30 bg-[color:var(--color-no)]/8 p-6">
                <p className="text-base font-700 leading-relaxed text-[color:var(--color-mist)]">
                  Por seguridad, no estás autorizado para ingresar en este turno.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-fog)]">
                  Dirígete con tu supervisor de turno.
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
