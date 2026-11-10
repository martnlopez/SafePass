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
import { signOut, type WorkerProfile } from "./lib/auth"
import { semiBlockUntil } from "./lib/block"
import type { BatteryResult } from "./lib/data"
import { fetchPendingDecisionForWorker, type SupervisorDecision } from "./lib/decisions"
import { fetchLatestResult, recordResult, startEvaluation } from "./lib/results"

type WorkerView = "login" | "decision" | "dashboard" | "test" | "saving" | "results"
type Mode = "worker" | "supervisor"

export default function App() {
  const [mode, setMode] = useState<Mode>("worker")
  const [view, setView] = useState<WorkerView>("login")
  const [supView, setSupView] = useState<"menu" | "dashboard" | "validate">("menu")
  const [profile, setProfile] = useState<WorkerProfile | null>(null)
  const [result, setResult] = useState<BatteryResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [decision, setDecision] = useState<SupervisorDecision | null>(null)
  // Sesión de evaluación emitida por el servidor (requisito para registrar el resultado)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Cierra la sesión de Supabase y vuelve al login (trabajador o supervisor)
  async function logout() {
    await signOut()
    setProfile(null)
    setResult(null)
    setDecision(null)
    setSaveError(null)
    setSessionId(null)
    setStartError(null)
    setMode("worker")
    setSupView("menu")
    setView("login")
  }

  // Tras validar Ficha ID + PIN: el rol y el estado del caso vienen del servidor
  async function handleLogin(p: WorkerProfile) {
    setProfile(p)
    if (p.role === "supervisor") {
      setMode("supervisor")
      return
    }
    const latest = await fetchLatestResult(p.id)
    // Decisión del supervisor: se muestra antes de iniciar o retomar la evaluación
    const pending = await fetchPendingDecisionForWorker(p.id, latest?.completedAt)
    if (pending) {
      setDecision(pending)
      setView("decision")
      return
    }
    // SEMI APTO reciente: retoma la pantalla de resultado con el descanso restante
    if (latest?.breakdown && semiBlockUntil(latest)) {
      setResult({ fichaId: p.fichaId, score: latest.score, z: 0, breakdown: latest.breakdown, completedAt: latest.completedAt })
      setSaveError(null)
      setView("results")
      return
    }
    setView("dashboard")
  }

  // El servidor abre la sesión solo si las reglas permiten evaluar (descansos, decisión pendiente)
  async function startTest() {
    if (starting) return
    setStarting(true)
    setStartError(null)
    try {
      setSessionId(await startEvaluation())
      setView("test")
    } catch (err) {
      setStartError((err as Error).message)
    } finally {
      setStarting(false)
    }
  }

  async function handleComplete(r: BatteryResult) {
    if (!profile) return
    setView("saving")
    try {
      if (!sessionId) throw new Error("La sesión de evaluación no es válida. Vuelve a iniciar la evaluación.")
      // El servidor fija la hora y aplica las reglas; el panel del supervisor lo recibe en tiempo real
      const saved = await recordResult(sessionId, r)
      setSessionId(null)
      // Puntaje y hora oficiales: los recalcula el servidor a partir del desglose
      setResult({ ...r, score: saved.score, completedAt: saved.completedAt })
      setSaveError(null)
    } catch (err) {
      setResult(r)
      setSaveError((err as Error).message)
    }
    setView("results")
  }

  // El área de supervisión solo es accesible autenticándose con una ficha de rol supervisor
  if (mode === "supervisor") {
    if (supView === "dashboard") return <SupervisorDashboard onBack={() => setSupView("menu")} />
    if (supView === "validate") return <PassValidator onBack={() => setSupView("menu")} />
    return (
      <SupervisorMenu
        onDashboard={() => setSupView("dashboard")}
        onValidate={() => setSupView("validate")}
        onLogout={() => void logout()}
      />
    )
  }

  const isTest = view === "test"

  return (
    <div className="relative min-h-screen w-full">
      <WorkerShell mode={isTest ? "test" : "default"}>
        {view === "login" && <WorkerLogin onLogin={handleLogin} />}
        {view === "decision" && decision && profile && (
          <SupervisorDecisionNotice
            decision={decision}
            fichaId={profile.fichaId}
            onStartTest={() => setView("dashboard")}
            onExit={() => void logout()}
          />
        )}
        {view === "dashboard" && profile && (
          <WorkerDashboard
            profile={profile}
            onStart={() => void startTest()}
            starting={starting}
            startError={startError}
            onLogout={() => void logout()}
          />
        )}
        {view === "test" && profile && <CognitiveTest fichaId={profile.fichaId} onComplete={(r) => void handleComplete(r)} />}
        {view === "saving" && (
          <div className="grid min-h-screen place-items-center bg-[color:var(--color-ink)]">
            <p className="font-mono text-sm uppercase tracking-[0.25em] text-[color:var(--color-fog)]">Guardando resultado…</p>
          </div>
        )}
        {view === "results" && result && (
          <TestResults result={result} saveError={saveError} onRetry={() => setView("test")} onDone={() => void logout()} />
        )}
      </WorkerShell>
    </div>
  )
}
