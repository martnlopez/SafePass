import { useEffect, useState } from "react"
import type { WorkerProfile } from "../lib/auth"
import { fetchHistory, type StoredResult } from "../lib/results"

const LOGOUT_BTN =
  "rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-2 font-mono text-xs uppercase tracking-wider text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)] hover:text-white"

export default function WorkerDashboard({
  profile,
  onStart,
  onLogout,
  starting = false,
  startError = null,
}: {
  profile: WorkerProfile
  onStart: () => void
  onLogout: () => void
  starting?: boolean
  startError?: string | null
}) {
  const today = new Date().toLocaleDateString("es-CL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  })

  const fichaId = profile.fichaId
  // Perfil y el mismo historial que ve el panel de supervisión (Supabase)
  const worker = { role: profile.position, company: profile.company ?? "Sin empresa", shift: profile.shift }
  const [history, setHistory] = useState<StoredResult[]>([])
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading")
  useEffect(() => {
    let cancelled = false
    fetchHistory(profile.id)
      .then((h) => {
        if (!cancelled) {
          setHistory(h)
          setHistoryState("ready")
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryState("error")
      })
    return () => {
      cancelled = true
    }
  }, [profile.id])
  const scores = history.map((r) => r.score)
  const last = scores.length ? scores[scores.length - 1]! : null
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  // Racha: evaluaciones APTO consecutivas, desde la más reciente
  let streak = 0
  for (let i = history.length - 1; i >= 0 && history[i]!.status === "apto"; i--) streak++

  const pending = historyState === "loading" ? "…" : historyState === "error" ? "Sin conexión" : null
  const METRICS = [
    { k: "Racha",          v: pending ?? (history.length ? `${streak} apto${streak === 1 ? "" : "s"}` : "Sin historial") },
    { k: "Último puntaje", v: pending ?? (last === null ? "—" : `${last} / 100`) },
    { k: "Evaluaciones",   v: pending ?? (history.length ? `${history.length} registrada${history.length === 1 ? "" : "s"}` : "Sin registro") },
    { k: "Promedio",       v: pending ?? (average === null ? "—" : `${average} / 100`) },
  ]

  const TESTS = [
    { n: "01", label: "Selección de Figuras" },
    { n: "02", label: "PVT Táctil" },
    { n: "03", label: "Go / No-Go" },
    { n: "04", label: "Memoria de Trabajo" },
    { n: "05", label: "Tracking Numérico" },
  ]

  return (
    <div className="min-h-screen w-full bg-[color:var(--color-ink)]">

      {/* ─────────────────────────────────────────────────────────
          MOBILE: columna única (≤ lg)
          DESKTOP: apilado vertical full-width (≥ lg)
      ───────────────────────────────────────────────────────── */}

      {/* ── MOBILE layout ── */}
      <div className="flex flex-col px-6 py-8 lg:hidden">
        {/* Header */}
        <header className="fade-up flex items-start justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">{today}</p>
            <h1 className="mt-1 font-mono text-2xl font-800 tracking-wide text-[color:var(--color-mist)]">{fichaId}</h1>
            <p className="mt-0.5 text-sm text-[color:var(--color-mist)]">
              {worker ? `${worker.role} · ${worker.company}` : "Trabajador sin registro"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-3 py-2 text-center">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-fog)]">Turno</p>
              <p className="font-mono text-sm font-700 text-[color:var(--color-semi)]">
                {worker?.shift?.toUpperCase() ?? "SIN TURNO"}
              </p>
            </div>
            <button onClick={onLogout} className={LOGOUT_BTN}>
              Cerrar sesión
            </button>
          </div>
        </header>
        <div className="fade-up mt-6 grid grid-cols-2 gap-3" style={{ animationDelay: "60ms" }}>
          {METRICS.map((s) => (
            <div key={s.k} className="rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-fog)]">{s.k}</p>
              <p className="mt-1 font-mono text-lg font-700">{s.v}</p>
            </div>
          ))}
        </div>
        <div className="fade-up mt-6 flex-1 overflow-hidden rounded-2xl border border-[color:var(--color-slate-line)] bg-gradient-to-b from-[color:var(--color-steel-2)] to-[color:var(--color-steel)]" style={{ animationDelay: "120ms" }}>
          <div className="flex h-full flex-col justify-between p-6">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-semi)]/40 bg-[color:var(--color-semi)]/12 px-3 py-1 font-mono text-[11px] font-600 uppercase tracking-wider text-[color:var(--color-semi)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-semi)]" />
                Pendiente hoy
              </span>
              <h2 className="mt-5 text-3xl font-800 leading-tight tracking-tight">Evaluación Diaria de Aptitud</h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--color-mist)]">
                5 pruebas continuas que miden tu tiempo de reacción, control inhibitorio, memoria y atención sostenida. Requerida para autorizar tu ingreso a faena.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Duración est. 4 min", "5 pruebas", "1 intento base"].map((t) => (
                  <span key={t} className="rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)]/40 px-3 py-1.5 font-mono text-[11px] text-[color:var(--color-mist)]">{t}</span>
                ))}
              </div>
            </div>
            {startError && (
              <p role="alert" className="mt-6 rounded-lg border border-[color:var(--color-no)] bg-[color:var(--color-ink)]/40 px-4 py-3 text-sm text-white">
                {startError}
              </p>
            )}
            <button onClick={onStart} disabled={starting} className="mt-8 flex h-16 w-full items-center justify-between rounded-xl bg-[color:var(--color-semi)] px-6 transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99] disabled:opacity-60">
              <span className="text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)]">{starting ? "Preparando…" : "Iniciar evaluación"}</span>
              <span className="text-2xl font-800 text-[color:var(--color-ink)]">→</span>
            </button>
          </div>
        </div>
        <p className="fade-up mt-4 text-center font-mono text-[11px] text-[color:var(--color-fog)]" style={{ animationDelay: "160ms" }}>
          En caso de fallo del sistema, avisa a tu supervisor de turno.
        </p>
      </div>

      {/* Layout Split: desktop (>=lg) renderiza tótem landscape 16:9; mobile usa columna */}
      {/* Canvas Lock: p-8 (32px) crea safe-area — el contenido flota, nunca toca el bisel */}
      <div className="hidden min-h-screen flex-col bg-[color:var(--color-ink)] p-8 lg:flex">

        <header className="fade-up flex shrink-0 items-start justify-between px-1">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-[color:var(--color-fog)]">
              {today.toUpperCase()}
            </p>
            <div className="mt-1.5 flex items-baseline gap-4">
              {/* Ley 19.628 (Datos Personales): identificador operacional Ficha ID · RUT prohibido en UI de faena */}
              <h1 className="font-mono text-3xl font-800 tracking-widest text-white">{fichaId}</h1>
              <span className="text-sm text-[color:var(--color-fog)]">
                {worker ? `${worker.role} · ${worker.company}` : "Trabajador sin registro"}
              </span>
            </div>
          </div>
          {/* Shift Badge · Accent #FFAE00 sobre Surface #161F30 — pill de estado no interactiva */}
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-5 py-2 shadow-lg shadow-black/30">
              <p className="font-mono text-xs font-700 uppercase tracking-[0.25em] text-[color:var(--color-semi)]">
                Turno {worker?.shift ?? "sin asignar"}
              </p>
            </div>
            <button onClick={onLogout} className={LOGOUT_BTN}>
              Cerrar sesión
            </button>
          </div>
        </header>

        {/* KPI Strip: grid-cols-4 fijo + gap-4 (16px) — módulos independientes, sin divisores compartidos */}
        {/* Card token: bg #161F30 / border #28354A / radius-xl — cada KPI es unidad flotante autónoma */}
        <div className="fade-up mt-6 grid shrink-0 grid-cols-4 gap-4" style={{ animationDelay: "60ms" }}>
          {METRICS.map((s) => (
            <div
              key={s.k}
              className="rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-4"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">{s.k}</p>
              {/* tabular-nums: alinea dígitos entre KPIs para lectura vertical rápida */}
              <p className="mt-1.5 font-mono text-3xl font-800 tabular-nums text-white">{s.v}</p>
            </div>
          ))}
        </div>

        {/* Primary Panel: flex-1 + min-h-0 absorbe el alto restante del viewport sin desbordar */}
        <div
          className="fade-up mt-5 flex min-h-0 flex-1 flex-col rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-7 shadow-2xl shadow-black/40"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex shrink-0 items-start justify-between gap-6">
            <div>
              {/* Status Tag · Accent #FFAE00 — señala tarea diaria obligatoria (gating de acceso a faena) */}
              <span className="inline-flex items-center gap-2 font-mono text-[11px] font-600 uppercase tracking-wider text-[color:var(--color-semi)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-semi)]" />
                Pendiente hoy
              </span>
              <h2 className="mt-3 text-4xl font-800 leading-tight tracking-tight text-white">
                Evaluación Diaria de Aptitud
              </h2>
              <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[color:var(--color-fog)]">
                5 pruebas continuas que miden tu tiempo de reacción, control inhibitorio, memoria y atención sostenida.
                Requerida para autorizar tu ingreso a faena.
              </p>
            </div>
            {/* Meta Pills · Surface Inset #1E283A — contrato del test (duración/nº pruebas/intentos) */}
            <div className="flex shrink-0 gap-2 pt-1">
              {["Duración est. 4 min", "5 pruebas", "1 intento base"].map((t) => (
                <span
                  key={t}
                  className="rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] px-3 py-1.5 font-mono text-[11px] text-[color:var(--color-mist)]"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* grid-rows-5 + flex-1: cada prueba reparte alto equitativo, ancla el CTA al pie sin scroll */}
          <div className="mt-6 grid min-h-0 flex-1 grid-rows-5 gap-2.5">
            {TESTS.map((t) => (
              <div
                key={t.n}
                className="flex items-center gap-5 rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] px-5"
              >
                {/* Index token · Accent #FFAE00 — secuencia fija; el orden es parte del protocolo clínico */}
                <span className="font-mono text-sm font-700 tabular-nums text-[color:var(--color-semi)]">{t.n}</span>
                <span className="h-5 w-px bg-[color:var(--color-slate-line)]" />
                <span className="text-base font-600 text-white">{t.label}</span>
              </div>
            ))}
          </div>

          {/* Primary CTA · Touch Target 60px | Action #FFAE00 / label #0B101D — pressed feedback vía #E09B00 */}
          <button
            onClick={onStart}
            className="mt-6 flex h-[60px] w-full shrink-0 items-center justify-between rounded-xl bg-[color:var(--color-semi)] px-8 transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.995]"
          >
            <span className="text-xl font-800 uppercase tracking-widest text-[color:var(--color-ink)]">
              Iniciar evaluación
            </span>
            <span className="text-3xl font-800 text-[color:var(--color-ink)]">→</span>
          </button>
        </div>

        {/* Failover Notice: contingencia operativa fuera de tarjetas — jerarquía visual mínima */}
        <p className="fade-up mt-5 shrink-0 text-center font-mono text-[11px] text-[color:var(--color-fog)]" style={{ animationDelay: "160ms" }}>
          En caso de fallo del sistema, avisa a tu supervisor de turno.
        </p>

      </div>
    </div>
  )
}
