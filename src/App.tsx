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
import ActivePassView from "./components/ActivePassView"
import { fetchActivePass, type AccessPass } from "./lib/pass"
import { signOut, type WorkerProfile } from "./lib/auth"
import { semiBlockUntil } from "./lib/block"
import type { BatteryResult } from "./lib/data"
import { fetchPendingDecisionForWorker, type SupervisorDecision } from "./lib/decisions"
import { fetchLatestResult, recordResult, startEvaluation } from "./lib/results"

type WorkerView = "login" | "decision" | "dashboard" | "test" | "saving" | "results" | "pass"

/** Un resultado APTO habilita el pase durante 12 h (mismo plazo que aplica el servidor) */
const APTO_VALID_MS = 12 * 60 * 60_000
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
  // Pase vigente encontrado al volver a iniciar sesión
  const [activePass, setActivePass] = useState<AccessPass | null>(null)
  // Resultado terminado que no se pudo guardar (p. ej. sin señal), pendiente de reenvío
  const [unsaved, setUnsaved] = useState<BatteryResult | null>(null)

  // Cierra la sesión de Supabase y vuelve al login (trabajador o supervisor)
  async function logout() {
    await signOut()
    setProfile(null)
    setResult(null)
    setDecision(null)
    setSaveError(null)
    setSessionId(null)
    setStartError(null)
    setActivePass(null)
    setUnsaved(null)
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
    const latest = await fetchLatestResult()
    // Decisión del supervisor: se muestra antes de iniciar o retomar la evaluación
    const pending = await fetchPendingDecisionForWorker(latest?.completedAt)
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
    // Pase vigente (APTO de las últimas 12 h o Pase Excepcional ya emitido): se vuelve a mostrar.
    // Si falla la consulta, sigue al panel normal en vez de bloquear el ingreso.
    const pass = await fetchActivePass().catch(() => null)
    const passIsCurrent = pass !== null && (!latest || pass.issuedAt >= latest.completedAt)
    const aptoIsCurrent = latest?.status === "apto" && Date.now() - latest.completedAt < APTO_VALID_MS
    if (aptoIsCurrent && latest?.breakdown) {
      // Pantalla de resultado APTO: muestra el pase o permite generarlo si aún no lo hizo
      setResult({ fichaId: p.fichaId, score: latest.score, z: 0, breakdown: latest.breakdown, completedAt: latest.completedAt })
      setActivePass(passIsCurrent ? pass : null)
      setSaveError(null)
      setView("results")
      return
    }
    if (passIsCurrent) {
      setActivePass(pass)
      setView("pass")
      return
    }
    setView("dashboard")
  }

  // El servidor abre la sesión solo si las reglas permiten evaluar (descansos, decisión pendiente)
  async function startTest() {
    if (starting) return
    setStarting(true)
    setStartError(null)
    setActivePass(null)
    try {
      setSessionId(await startEvaluation())
      setView("test")
    } catch (err) {
      setStartError((err as Error).message)
      setView("dashboard")
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
      setUnsaved(null)
      // Puntaje y hora oficiales: los recalcula el servidor a partir del desglose
      setResult({ ...r, score: saved.score, completedAt: saved.completedAt })
      setSaveError(null)
    } catch (err) {
      // El resultado queda en memoria junto a su sesión: "Reintentar envío" lo reenvía sin
      // repetir el test (el servidor es idempotente por sesión)
      setUnsaved(sessionId ? r : null)
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
          <TestResults
            // Remonta al cambiar de resultado para no arrastrar el pase anterior
            key={result.completedAt ?? "nuevo"}
            result={result}
            saveError={saveError}
            initialPass={activePass}
            // Reintentar abre una sesión nueva en el servidor (la anterior ya no sirve)
            onRetry={() => void startTest()}
            onResend={unsaved ? () => void handleComplete(unsaved) : undefined}
            onDone={() => void logout()}
          />
        )}
        {view === "pass" && activePass && profile && (
          <ActivePassView pass={activePass} fichaId={profile.fichaId} onExit={() => void logout()} />
        )}
      </WorkerShell>
    </div>
  )
}
