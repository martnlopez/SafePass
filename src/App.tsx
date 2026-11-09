import { useState } from "react"
import WorkerLogin from "./components/WorkerLogin"
import WorkerDashboard from "./components/WorkerDashboard"
import CognitiveTest from "./components/CognitiveTest"
import TestResults from "./components/TestResults"
import SupervisorDashboard from "./components/SupervisorDashboard"
import WorkerShell from "./components/WorkerShell"
import SupervisorMenu from "./components/SupervisorMenu"
import PassValidator from "./components/PassValidator"
import SupervisorDecisionNotice from "./components/SupervisorDecisionNotice"
import type { BatteryResult } from "./lib/data"
import { clearBlock, getActiveBlock } from "./lib/block"
import { getPendingDecisionForWorker, type SupervisorDecision } from "./lib/decisions"
import { recordResult } from "./lib/results"

type WorkerView = "login" | "decision" | "dashboard" | "test" | "results"
type Mode = "worker" | "supervisor"

export default function App() {
  const [mode, setMode] = useState<Mode>("worker")
  const [view, setView] = useState<WorkerView>("login")
  const [supView, setSupView] = useState<"menu" | "dashboard" | "validate">("menu")
  const [fichaId, setFichaId] = useState("")
  const [staffId, setStaffId] = useState("")
  const [result, setResult] = useState<BatteryResult | null>(null)
  const [decision, setDecision] = useState<SupervisorDecision | null>(null)

  // El área de supervisión solo es accesible autenticándose con una ficha de rol supervisor
  if (mode === "supervisor") {
    const logout = () => {
      setMode("worker")
      setView("login")
      setSupView("menu")
    }
    if (supView === "dashboard") return <SupervisorDashboard supervisorId={staffId} onBack={() => setSupView("menu")} />
    if (supView === "validate") return <PassValidator onBack={() => setSupView("menu")} />
    return (
      <SupervisorMenu
        onDashboard={() => setSupView("dashboard")}
        onValidate={() => setSupView("validate")}
        onLogout={logout}
      />
    )
  }

  const isTest = view === "test"

  return (
    <div className="relative min-h-screen w-full">
      <WorkerShell mode={isTest ? "test" : "default"}>
        {view === "login" && (
          <WorkerLogin
            onLogin={(id, role) => {
              if (role === "supervisor") {
                setStaffId(id)
                setMode("supervisor")
                return
              }
              setFichaId(id)
              // Decisión del supervisor: se muestra antes de iniciar o retomar la evaluación
              const pending = getPendingDecisionForWorker(id)
              if (pending) {
                setDecision(pending)
                setView("decision")
                return
              }
              // Bloqueo vigente: retoma la pantalla de resultado con el contador restante
              const block = getActiveBlock(id)
              if (block) {
                setResult(block.result)
                setView("results")
                return
              }
              setView("dashboard")
            }}
          />
        )}
        {view === "decision" && decision && (
          <SupervisorDecisionNotice
            decision={decision}
            onStartTest={() => {
              // Re-test autorizado: el supervisor levanta también el descanso de 5 min
              clearBlock(fichaId)
              setView("dashboard")
            }}
            onExit={() => setView("login")}
          />
        )}
        {view === "dashboard" && (
          <WorkerDashboard fichaId={fichaId} onStart={() => setView("test")} onLogout={() => setView("login")} />
        )}
        {view === "test" && (
          <CognitiveTest
            fichaId={fichaId}
            onComplete={(r) => {
              // Persiste el resultado (puntaje, estado, hora y desglose): el panel de supervisión lo refleja de inmediato
              recordResult(r)
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
    </div>
  )
}
