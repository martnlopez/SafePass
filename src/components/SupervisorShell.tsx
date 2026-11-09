import type { ReactNode } from "react"
import Logo from "./Logo"

export default function SupervisorShell({
  action,
  children,
}: {
  action?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  return (
    <div className="min-h-screen w-full bg-[color:var(--color-ink)]">
      <header className="border-b border-[color:var(--color-slate-line)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <div className="leading-tight">
              <p className="text-sm font-800 tracking-tight">SafePass · Supervisión</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[color:var(--color-fog)]">
                Minera Andina
              </p>
            </div>
          </div>
          {action && (
            <button
              onClick={action.onClick}
              className="rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-2 font-mono text-xs uppercase tracking-wider text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)]"
            >
              {action.label}
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  )
}

export function MenuCard({
  title,
  desc,
  icon,
  onClick,
}: {
  title: string
  desc: string
  icon: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="fade-up flex w-full items-center gap-5 rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6 text-left transition-all hover:border-[color:var(--color-semi)] hover:bg-[color:var(--color-steel-2)] active:scale-[0.99]"
    >
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-[color:var(--color-semi)]/40 bg-[color:var(--color-semi)]/12 text-2xl">
        {icon}
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-800 uppercase tracking-wide text-white">{title}</span>
        <span className="mt-1 block text-sm text-[color:var(--color-fog)]">{desc}</span>
      </span>
      <span className="ml-auto text-2xl font-800 text-[color:var(--color-semi)]">→</span>
    </button>
  )
}
