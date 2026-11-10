import { useEffect, useRef, useState } from "react"
import CameraScanner from "./CameraScanner"
import SupervisorShell, { MenuCard } from "./SupervisorShell"
import { REVOKE_REASON_TEXT, formatPassCode, isCompletePassCode, validatePass, type ValidationResult } from "../lib/pass"

// Mismo corte que el resto de la app: < lg = móvil/tablet, >= lg = escritorio.
function useIsMobile() {
  const query = "(max-width: 1023px)"
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return mobile
}

// Formulario compartido por escritorio y móvil: el código se formatea mientras se escribe (SP-XXXXXX)
function CodeForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("")
  const complete = isCompletePassCode(code)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (complete) onSubmit(code)
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Código alfanumérico del pase
        </span>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(formatPassCode(e.target.value, code))}
          placeholder="SP-2AAE91"
          // Holgura para pegar códigos con espacios; el formateo deja siempre SP- + 6 caracteres
          maxLength={16}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-4 text-center font-mono text-2xl font-700 tracking-[0.2em] outline-none transition-colors placeholder:text-[color:var(--color-fog)]/40 focus:border-[color:var(--color-semi)]"
        />
      </label>
      <button
        type="submit"
        disabled={!complete}
        className="h-16 w-full rounded-xl bg-[color:var(--color-semi)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[color:var(--color-steel-2)] disabled:text-[color:var(--color-fog)]"
      >
        Verificar pase
      </button>
    </form>
  )
}

function ResultModal({ result, onClose }: { result: ValidationResult; onClose: () => void }) {
  const ok = result.status === "valid"
  const tone = ok ? "var(--color-apt)" : "var(--color-no)"
  const title =
    result.status === "valid"
      ? "PASE VÁLIDO - OPERADOR APTO"
      : result.status === "expired"
        ? "PASE EXPIRADO"
        : result.status === "revoked"
          ? "PASE REVOCADO"
        : result.status === "error"
          ? "NO SE PUDO VERIFICAR"
          : "PASE INVÁLIDO"
  const fmt = (t: number) => new Date(t).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="scale-in w-full max-w-sm rounded-2xl border-2 bg-[color:var(--color-steel)] p-6 text-center"
        style={{ borderColor: tone }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto grid h-16 w-16 place-items-center rounded-full text-3xl font-800 text-[color:var(--color-ink)]"
          style={{ background: tone }}
        >
          {ok ? "✓" : "✕"}
        </div>
        <h2 className="mt-4 text-xl font-800 leading-tight tracking-tight" style={{ color: tone }}>
          {title}
        </h2>
        {result.status === "invalid" ? (
          <p className="mt-2 text-sm text-[color:var(--color-fog)]">
            El código no corresponde a ningún pase emitido. No autorices el ingreso.
          </p>
        ) : result.status === "error" ? (
          <p className="mt-2 text-sm text-[color:var(--color-fog)]">
            {result.message} No autorices el ingreso hasta poder verificar el pase.
          </p>
        ) : (
          <>
          {result.status === "revoked" && (
            <p className="mt-2 text-sm text-[color:var(--color-fog)]">
              {REVOKE_REASON_TEXT[result.reason]} No autorices el ingreso.
            </p>
          )}
          <div className="mt-4 space-y-1 rounded-xl bg-[color:var(--color-ink)] p-4 font-mono text-sm text-[color:var(--color-mist)]">
            <p className="text-lg font-800 text-white">{result.pass.fichaId}</p>
            <p className="text-[color:var(--color-mist)]">{result.holder.fullName}</p>
            <p className="text-[color:var(--color-fog)]">
              {result.holder.position}
              {result.holder.company ? ` · ${result.holder.company}` : ""}
            </p>
            <p className="text-[color:var(--color-fog)]">Código {result.pass.code}</p>
            <p className="text-[color:var(--color-fog)]">Emitido {fmt(result.pass.issuedAt)}</p>
            <p className="text-[color:var(--color-fog)]">
              {result.status === "expired" ? "Venció" : "Vence"} {fmt(result.pass.expiresAt)}
            </p>
          </div>
          </>
        )}
        <button
          onClick={onClose}
          className="mt-6 h-14 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)]"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}

export default function PassValidator({ onBack }: { onBack: () => void }) {
  const mobile = useIsMobile()
  const [method, setMethod] = useState<"qr" | "code" | null>(null)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [checking, setChecking] = useState(false)
  // Evita consultas duplicadas: la cámara puede leer el mismo QR varias veces seguidas
  const inFlight = useRef(false)

  async function check(input: string) {
    if (inFlight.current) return
    inFlight.current = true
    setChecking(true)
    try {
      setResult(await validatePass(input))
    } finally {
      inFlight.current = false
      setChecking(false)
    }
  }

  // Escritorio: solo código manual. Móvil/tablet: elegir QR o código.
  const active = mobile ? method : "code"

  function handleBack() {
    if (mobile && method) setMethod(null)
    else onBack()
  }

  return (
    <SupervisorShell action={{ label: "← Volver", onClick: handleBack }}>
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-semi)]">
        Verificación de accesos
      </p>
      <h1 className="mt-2 text-3xl font-800 tracking-tight">Validar pase de entrada</h1>

      <div className="mt-8">
        {active === null && (
          <div className="space-y-4">
            <MenuCard
              icon="▣"
              title="Validar con código QR"
              desc="Escanea el QR del pase con la cámara."
              onClick={() => setMethod("qr")}
            />
            <MenuCard
              icon="⌨"
              title="Validar con código alfanumérico"
              desc="Ingresa manualmente el código (ej. SP-2AAE91)."
              onClick={() => setMethod("code")}
            />
          </div>
        )}
        {active === "code" && <CodeForm onSubmit={(c) => void check(c)} />}
        {/* Con el modal abierto el visor se desmonta (apaga la cámara) y se reactiva al cerrarlo */}
        {active === "qr" && !result && !checking && (
          <CameraScanner onScan={(data) => void check(data)} onCancel={() => setMethod(null)} cancelLabel="Volver" />
        )}
        {checking && (
          <p role="status" className="mt-4 text-center font-mono text-xs uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
            Verificando pase…
          </p>
        )}
      </div>

      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
    </SupervisorShell>
  )
}
