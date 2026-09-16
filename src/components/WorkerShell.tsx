type Props = {
  children: React.ReactNode
  mode?: "default" | "test"
}

export default function WorkerShell({ children, mode = "default" }: Props) {
  if (mode === "test") {
    // Full viewport: la vista del test gestiona su propio layout 100vw/100vh.
    return <div className="h-screen w-full bg-[color:var(--color-ink)]">{children}</div>
  }
  // default: children handle their own layout
  return <>{children}</>
}
