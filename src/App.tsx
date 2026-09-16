import { useState } from "react"
import WorkerLogin from "./components/WorkerLogin"
import WorkerDashboard from "./components/WorkerDashboard"
import CognitiveTest from "./components/CognitiveTest"
import TestResults from "./components/TestResults"
import SupervisorDashboard from "./components/SupervisorDashboard"
import WorkerShell from "./components/WorkerShell"
import type { BatteryResult } from "./lib/data"

type WorkerView = "login" | "dashboard" | "test" | "results"
type Mode = "worker" | "supervisor"

export default function App() {
  const [mode, setMode] = useState<Mode>("worker")
  const [view, setView] = useState<WorkerView>("login")
  const [fichaId, setFichaId] = useState("TRB-0512")
  const [result, setResult] = useState<BatteryResult | null>(null)

  if (mode === "supervisor") {
    return <SupervisorDashboard onExit={() => setMode("worker")} />
  }

  const isTest = view === "test"

  return (
    <div className="relative min-h-screen w-full">
      <WorkerShell mode={isTest ? "test" : "default"}>
        {view === "login" && (
          <WorkerLogin
            onLogin={(id) => {
              setFichaId(id)
              setView("dashboard")
            }}
          />
        )}
        {view === "dashboard" && <WorkerDashboard fichaId={fichaId} onStart={() => setView("test")} />}
        {view === "test" && (
          <CognitiveTest
            fichaId={fichaId}
            onComplete={(r) => {
              setResult(r)
              setView("results")
            }}
          />
        )}
        {view === "results" && result && (
          <TestResults
            result={result}
            onRetry={() => setView("test")}
            onDone={() => setView("login")}
          />
        )}
      </WorkerShell>

      {/* Role switch — demo affordance */}
      <button
        onClick={() => setMode("supervisor")}
        className="fixed bottom-5 right-5 z-20 rounded-full border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)]/90 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-mist)] shadow-lg backdrop-blur transition-colors hover:border-[color:var(--color-semi)] hover:text-[color:var(--color-semi)]"
      >
        Panel supervisor →
      </button>
    </div>
  )
}
