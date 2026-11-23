import { useEffect, useRef, useState } from "react"
import UpdateBanner from "./components/UpdateBanner"
import { useAppUpdate } from "./lib/appUpdate"
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
import { isTransientError } from "./lib/supabase"

type WorkerView = "login" | "decision" | "dashboard" | "test" | "saving" | "results" | "pass"

/** Un resultado APTO habilita el pase durante 12 h (mismo plazo que aplica el servidor) */
const APTO_VALID_MS = 12 * 60 * 60_000
/** Cada cuánto se reintenta solo un resultado pendiente (además de al volver la señal) */
const AUTO_RESEND_MS = 20_000
type Mode = "worker" | "supervisor"

/**
 * Resultado terminado que aún no llega al servidor (corte de señal). Vive solo en memoria:
 * el tótem es compartido y un resultado de salud no se guarda en el equipo (D6, D10).
 */
interface PendingSubmit {
  /** Sesión de evaluación a la que pertenece (no se toma del estado: evita mezclar trabajadores) */
  sessionId: string
  result: BatteryResult
  /** Duración del test medida con reloj monotónico (no depende de la hora del equipo) */
  durationSeconds: number
  /** Plazo para seguir reintentando (performance.now): el mismo de 2 h que acepta el servidor */
  retryUntil: number
}

/** El servidor acepta el envío hasta 2 h después de abrir la sesión (D10) */
const SUBMIT_WINDOW_MS = 2 * 60 * 60_000

/** Errores en los que conviene seguir reintentando: sin red, servidor caído o token vencido sin señal */
function isRetryableSubmitError(err: unknown): boolean {
  return isTransientError(err) || (err as { status?: number } | null)?.status === 401
}

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
  const [unsaved, setUnsaved] = useState<PendingSubmit | null>(null)
  // Inicio del test (performance.now) para medir su duración
  const testStartedAt = useRef<number | null>(null)
  // Envío en curso: el reintento automático y el botón comparten la misma petición
  const inFlight = useRef<Promise<void> | null>(null)
  const attemptSeq = useRef(0)
  // Cambia en cada cierre de sesión: lo que responda después de salir se descarta (tótem compartido)
  const uiEpoch = useRef(0)
  const { updateReady, applyUpdate } = useAppUpdate()

  // Versión nueva: se aplica sola solo en el login, sin nadie dentro (nunca durante un test).
  // Con sesión de trabajador abierta espera a que vuelva al login; el supervisor ve un aviso.
  const onIdleLogin = mode === "worker" && view === "login"
  useEffect(() => {
    if (updateReady && onIdleLogin) applyUpdate()
  }, [updateReady, onIdleLogin, applyUpdate])

  // Cierra la sesión de Supabase y vuelve al login (trabajador o supervisor)
  async function logout() {
    if (
      unsaved &&
      !window.confirm(
        "Tu resultado todavía no llega al servidor y se enviará solo cuando vuelva la señal. Si sales ahora, se pierde y tendrás que repetir el test. ¿Salir de todos modos?",
      )
    ) {
      return
    }
    // Primero se invalida todo lo que esté en curso: un envío que responda tarde no revive
    // el resultado de esta persona en la pantalla del siguiente trabajador
    uiEpoch.current += 1
    inFlight.current = null
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
      setResult({
        fichaId: p.fichaId,
        score: latest.score,
        z: 0,
        breakdown: latest.breakdown,
        completedAt: latest.completedAt,
        receivedAt: latest.receivedAt,
      })
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
      testStartedAt.current = performance.now()
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
    if (!sessionId) {
      setResult(r)
      setSaveError("La sesión de evaluación no es válida. Vuelve a iniciar la evaluación.")
      setView("results")
      return
    }
    const started = testStartedAt.current ?? performance.now()
    await submitResult({
      sessionId,
      result: r,
      durationSeconds: Math.round((performance.now() - started) / 1000),
      retryUntil: started + SUBMIT_WINDOW_MS,
    })
    setView("results")
  }

  /**
   * Envía el resultado. Si falla por la red, queda en memoria y se reintenta solo (el servidor
   * es idempotente por sesión y conserva la hora real de término). Si ya hay un envío en curso,
   * devuelve ese mismo.
   */
  function submitResult(pending: PendingSubmit): Promise<void> {
    if (inFlight.current) return inFlight.current
    const epoch = uiEpoch.current
    const attemptId = ++attemptSeq.current
    const attempt = (async () => {
      try {
        // El servidor fija la hora y aplica las reglas; el panel del supervisor lo recibe en tiempo real
        const saved = await recordResult(pending.sessionId, pending.result, pending.durationSeconds)
        if (epoch !== uiEpoch.current) return
        setSessionId(null)
        setUnsaved(null)
        // Puntaje y horas oficiales: los fija el servidor a partir del desglose
        setResult({ ...pending.result, score: saved.score, completedAt: saved.completedAt, receivedAt: saved.receivedAt })
        setSaveError(null)
      } catch (err) {
        if (epoch !== uiEpoch.current) return
        const inWindow = performance.now() < pending.retryUntil
        // Un error definitivo (p. ej. sesión vencida) no se reintenta: reenviar daría lo mismo
        setUnsaved(inWindow && isRetryableSubmitError(err) ? pending : null)
        setResult(pending.result)
        setSaveError(
          inWindow
            ? (err as Error).message
            : "Pasaron más de 2 horas sin poder enviar el resultado. Vuelve a rendir la evaluación o avisa a tu supervisor.",
        )
      } finally {
        // Solo el intento más reciente libera el turno (uno viejo, tras un logout, no pisa al nuevo)
        if (attemptSeq.current === attemptId) inFlight.current = null
      }
    })()
    inFlight.current = attempt
    return attempt
  }

  // Reenvío automático del resultado pendiente: al volver la señal y cada 20 s
  const resendPending = useRef<() => void>(() => undefined)
  resendPending.current = () => {
    if (unsaved && navigator.onLine) void submitResult(unsaved)
  }
  const hasPending = unsaved !== null && view === "results"
  useEffect(() => {
    if (!hasPending) return
    const retry = () => resendPending.current()
    // Cerrar o recargar la pestaña también perdería el resultado: el navegador pide confirmar
    const warnBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("online", retry)
    window.addEventListener("beforeunload", warnBeforeUnload)
    const timer = setInterval(retry, AUTO_RESEND_MS)
    return () => {
      window.removeEventListener("online", retry)
      window.removeEventListener("beforeunload", warnBeforeUnload)
      clearInterval(timer)
    }
  }, [hasPending])

  async function resendNow() {
    if (!unsaved) return
    setView("saving")
    await submitResult(unsaved)
    setView("results")
  }

  // El área de supervisión solo es accesible autenticándose con una ficha de rol supervisor
  if (mode === "supervisor") {
    return (
      <>
        {supView === "dashboard" && <SupervisorDashboard onBack={() => setSupView("menu")} />}
        {supView === "validate" && <PassValidator onBack={() => setSupView("menu")} />}
        {supView === "menu" && (
          <SupervisorMenu
            onDashboard={() => setSupView("dashboard")}
            onValidate={() => setSupView("validate")}
            onLogout={() => void logout()}
          />
        )}
        {updateReady && <UpdateBanner onUpdate={applyUpdate} />}
      </>
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
            onResend={unsaved ? () => void resendNow() : undefined}
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
