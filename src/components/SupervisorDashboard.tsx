import { useMemo, useState } from "react"
import { STATUS_META, type Evaluation, type Status } from "../lib/data"
import { isDecisionCurrent, useDecisions } from "../lib/decisions"
import { useEvaluations } from "../lib/results"
import DecisionTag from "./DecisionTag"
import { flagText } from "../lib/flags"
import StatusBadge from "./StatusBadge"
import ManageModal from "./ManageModal"
import Logo from "./Logo"

type StatusFilter = "todos" | Status
type ShiftFilter = "todos" | "Día" | "Noche"

export default function SupervisorDashboard({ onBack }: { onBack: () => void }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos")
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("todos")
  const [company, setCompany] = useState<string>("todas")
  const [managing, setManaging] = useState<Evaluation | null>(null)
  // Último resultado de cada trabajador (Supabase, en tiempo real desde cualquier dispositivo)
  const { evaluations, loading, error } = useEvaluations()
  // Última decisión de cada trabajador (se actualiza al guardar aquí o cuando se registra un NO APTO)
  const decisionMap = useDecisions()
  const decisionFor = (e: Evaluation) => {
    const d = decisionMap[e.workerId]
    return d && isDecisionCurrent(d, e.completedAt) ? d : null
  }

  const companies = useMemo(
    () => ["todas", ...Array.from(new Set(evaluations.map((e) => e.company)))],
    [evaluations],
  )

  const filtered = evaluations.filter(
    (e) =>
      (statusFilter === "todos" || e.status === statusFilter) &&
      (shiftFilter === "todos" || e.shift === shiftFilter) &&
      (company === "todas" || e.company === company),
  )

  // Métricas del turno recalculadas con el último resultado de cada ficha
  const total = evaluations.length
  const aptos = evaluations.filter((e) => e.status === "apto").length
  const semi = evaluations.filter((e) => e.status === "semi").length
  const noAptos = evaluations.filter((e) => e.status === "no")
  const liveCount = evaluations.filter((e) => e.live).length
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "—")

  const kpis = [
    { k: "Evaluados hoy", v: total, sub: "trabajadores", tone: "text-[color:var(--color-mist)]" },
    { k: "Aptos turno", v: pct(aptos), sub: `${aptos} personas`, tone: "text-[color:var(--color-apt)]" },
    { k: "En reintento", v: pct(semi), sub: `${semi} demora / semi apto`, tone: "text-[color:var(--color-semi)]" },
    { k: "Alertas / no aptos", v: noAptos.length, sub: "requieren acción", tone: "text-[color:var(--color-no)]" },
  ]

  return (
    <div className="h-screen w-full overflow-y-auto bg-[color:var(--color-ink)]">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4 lg:px-10">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="leading-tight">
              <p className="text-sm font-800 tracking-tight">SafePass · Control de Aptitud · Faena</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[color:var(--color-fog)]">
                Panel de supervisión · Minera Andina
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 md:flex">
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-apt)]" />
              <span className="font-mono text-xs text-[color:var(--color-fog)]">
                En vivo · {new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <button
              onClick={onBack}
              className="rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-2 font-mono text-xs uppercase tracking-wider text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)]"
            >
              ← Menú
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-10">
        <div className="fade-up flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-800 tracking-tight">Resumen de aptitud del turno</h1>
            <p className="mt-1 text-sm text-[color:var(--color-fog)]">
              {new Date().toLocaleDateString("es-CL", { weekday: "long", day: "2-digit", month: "long" })} · Turno día
            </p>
          </div>
        </div>

        {(loading || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`mt-4 rounded-xl border px-4 py-3 font-mono text-xs ${
              error
                ? "border-[color:var(--color-no)]/40 bg-[color:var(--color-no)]/10 text-[color:var(--color-mist)]"
                : "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] text-[color:var(--color-fog)]"
            }`}
          >
            {error ? `No se pudieron cargar las evaluaciones: ${error}` : "Cargando evaluaciones del turno…"}
          </p>
        )}

        {/* KPIs */}
        <section className="fade-up mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4" style={{ animationDelay: "60ms" }}>
          {kpis.map((c) => (
            <div
              key={c.k}
              className="rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-5"
            >
              <p className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
                {c.k}
              </p>
              <p className={`mt-3 font-mono text-4xl font-800 tabular-nums ${c.tone}`}>{c.v}</p>
              <p className="mt-1 text-xs text-[color:var(--color-fog)]">{c.sub}</p>
            </div>
          ))}
        </section>

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[340px_1fr]">
          {/* Critical alerts */}
          <section
            className="fade-up rounded-2xl border border-[color:var(--color-no)]/30 bg-[color:var(--color-no)]/[0.06] p-5"
            style={{ animationDelay: "120ms" }}
          >
            <div className="flex items-center gap-2">
              <span className="alert-pulse h-2.5 w-2.5 rounded-full bg-[color:var(--color-no)]" />
              <h2 className="font-800 uppercase tracking-wide text-[color:var(--color-no)]">
                Alertas críticas
              </h2>
            </div>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
              No aptos · máxima prioridad
            </p>

            <div className="mt-4 space-y-3">
              {noAptos.map((e) => (
                <div
                  key={e.id}
                  className="rounded-xl border border-[color:var(--color-no)]/30 bg-[color:var(--color-ink)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-mono font-700 tracking-wide text-[color:var(--color-mist)]">{e.id}</p>
                    <span className="font-mono text-xs text-[color:var(--color-no)]">{e.time}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[color:var(--color-fog)]">
                    <span>{e.role}</span>
                    <span>Turno {e.shift}</span>
                  </div>
                  <DecisionTag decision={decisionFor(e)} className="mt-3" />
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-mono text-2xl font-800 text-[color:var(--color-no)]">
                      {e.score}
                      <span className="ml-1 text-xs font-700 text-[color:var(--color-fog)]">/ 100</span>
                    </span>
                    <button
                      onClick={() => setManaging(e)}
                      className="rounded-lg bg-[color:var(--color-no)] px-3 py-1.5 font-mono text-[11px] font-700 uppercase tracking-wider text-white transition-colors hover:bg-[color:var(--color-no-dim)]"
                    >
                      Gestionar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Table */}
          <section className="fade-up" style={{ animationDelay: "160ms" }}>
            {/* Filters */}
            <div className="flex flex-wrap items-end gap-2">
              <FilterGroup
                label="Estado"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
                options={[
                  { value: "todos", label: "Todos" },
                  { value: "apto", label: "Apto" },
                  { value: "semi", label: "Semi" },
                  { value: "no", label: "No apto" },
                ]}
              />
              <FilterGroup
                label="Turno"
                value={shiftFilter}
                onChange={(v) => setShiftFilter(v as ShiftFilter)}
                options={[
                  { value: "todos", label: "Todos" },
                  { value: "Día", label: "Día" },
                  { value: "Noche", label: "Noche" },
                ]}
              />
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="ml-auto rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-3 py-2 font-mono text-xs text-[color:var(--color-mist)] outline-none transition-colors focus:border-[color:var(--color-semi)]"
              >
                {companies.map((c) => (
                  <option key={c} value={c}>
                    {c === "todas" ? "Todas las empresas" : c}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--color-slate-line)]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)]">
                      {["ID Ficha", "Cargo", "Turno", "Puntaje", "Estado", "Hora", ""].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left font-mono text-[11px] font-600 uppercase tracking-wider text-[color:var(--color-fog)]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr
                        key={e.id}
                        className="border-b border-[color:var(--color-slate-line)]/50 bg-[color:var(--color-ink)] transition-colors last:border-0 hover:bg-[color:var(--color-steel)]/60"
                      >
                        <td className="px-4 py-3">
                          <p className="font-mono font-700 tracking-wide text-[color:var(--color-mist)]">{e.id}</p>
                          <p className="font-mono text-[11px] text-[color:var(--color-fog)]">{e.company}</p>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--color-mist)]">{e.role}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[color:var(--color-fog)]">{e.shift}</td>
                        <td className="px-4 py-3">
                          <span className={`font-mono text-base font-800 tabular-nums ${STATUS_META[e.status].text}`}>
                            {e.score}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={e.status} />
                          {e.flags && (
                            <p
                              title={e.flags.map(flagText).join("\n")}
                              className="mt-1.5 inline-block rounded border border-[color:var(--color-semi)] px-1.5 py-0.5 font-mono text-[10px] font-700 uppercase tracking-wider text-[color:var(--color-semi)]"
                            >
                              Revisar · resultado atípico
                            </p>
                          )}
                          <DecisionTag decision={decisionFor(e)} className="mt-1.5" />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {e.live && e.completedAt ? (
                            <span
                              className="inline-flex items-center gap-1.5 text-[color:var(--color-mist)]"
                              title={`Evaluación registrada ${new Date(e.completedAt).toLocaleString("es-CL")}`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-apt)]" />
                              {e.time}
                            </span>
                          ) : (
                            <span className="text-[color:var(--color-fog)]">{e.time}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setManaging(e)}
                            className="rounded-lg border border-[color:var(--color-slate-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-semi)] hover:text-[color:var(--color-semi)]"
                          >
                            {e.status === "no" ? "Gestionar" : "Ver detalle"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center font-mono text-sm text-[color:var(--color-fog)]">
                          Sin evaluaciones para estos filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-3 font-mono text-[11px] text-[color:var(--color-fog)]">
              Mostrando {filtered.length} de {total} evaluaciones
              {liveCount > 0 && ` · ${liveCount} con resultado registrado en la app (●)`}
            </p>
          </section>
        </div>
      </main>

      {managing && (
        <ManageModal evaluation={managing} current={decisionMap[managing.workerId] ?? null} onClose={() => setManaging(null)} />
      )}
    </div>
  )
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="pl-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fog)]/60 select-none">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 font-mono text-xs font-600 transition-colors ${
              value === o.value
                ? "bg-[color:var(--color-semi)] text-[color:var(--color-ink)]"
                : "text-[color:var(--color-fog)] hover:text-[color:var(--color-mist)]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
