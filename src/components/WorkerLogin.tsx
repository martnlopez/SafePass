import { useState } from "react"

const PIN_LENGTH = 6

function NumPad({ pin, onChange }: { pin: string; onChange: (p: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"]

  function press(k: string) {
    if (k === "⌫") {
      onChange(pin.slice(0, -1))
    } else if (k === "C") {
      onChange("")
    } else if (pin.length < PIN_LENGTH) {
      onChange(pin + k)
    }
  }

  return (
    <div className="select-none">
      {/* PIN dots */}
      <div className="mb-5 flex justify-center gap-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-all duration-150 ${
              i < pin.length
                ? "border-[color:var(--color-semi)] bg-[color:var(--color-semi)] scale-110"
                : "border-[color:var(--color-slate-line)] bg-transparent"
            }`}
          />
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-3 gap-2.5">
        {keys.map((k) => {
          const isClear = k === "C"
          const isBack = k === "⌫"
          return (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className={`flex h-14 items-center justify-center rounded-xl border font-mono text-xl font-700 transition-all active:scale-95 lg:h-16
                ${isClear
                  ? "border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] text-[color:var(--color-fog)] hover:border-[color:var(--color-no)]/60 hover:text-[color:var(--color-no)]"
                  : isBack
                  ? "border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] text-[color:var(--color-fog)] hover:border-[color:var(--color-semi)]/60 hover:text-[color:var(--color-semi)]"
                  : "border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] text-[color:var(--color-mist)] hover:border-[color:var(--color-semi)]/60 hover:bg-[color:var(--color-steel-2)]"
                }`}
            >
              {k}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function WorkerLogin({ onLogin }: { onLogin: (fichaId: string) => void }) {
  const [ficha, setFicha] = useState("TRB-0512")
  const [pin, setPin] = useState("")
  const [scanning, setScanning] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [email, setEmail] = useState("")
  const [toast, setToast] = useState(false)
  const [error, setError] = useState(false)

  const fichaOk = /^TRB-\d{3,4}$/i.test(ficha.trim())
  const ready = fichaOk && pin.length === PIN_LENGTH

  function scan() {
    setScanning(true)
    setTimeout(() => {
      setFicha("TRB-0512")
      setScanning(false)
    }, 1400)
  }

  function handleLogin() {
    if (!ready) return
    // Demo: PIN 1234 is the valid PIN for all fichas
    if (pin !== "123456") {
      setError(true)
      setPin("")
      setTimeout(() => setError(false), 2200)
      return
    }
    setError(false)
    onLogin(ficha.trim().toUpperCase())
  }

  function sendRecovery() {
    if (!email.includes("@")) return
    setForgot(false)
    setEmail("")
    setToast(true)
    setTimeout(() => setToast(false), 4200)
  }

  return (
    <div className="min-h-screen w-full bg-[color:var(--color-ink)]">
      {/*
        Mobile: single-column, full-screen
        Desktop (lg): two-column — left: branding context, right: form
      */}
      <div className="mx-auto flex min-h-screen w-full flex-col lg:max-w-5xl lg:flex-row lg:items-stretch">

        {/* ── Left column: context panel (desktop only) ── */}
        <div className="hidden lg:flex lg:w-[46%] lg:shrink-0 lg:flex-col lg:justify-between lg:border-r lg:border-[color:var(--color-slate-line)] lg:px-14 lg:py-14">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--color-semi)] font-mono text-xl font-800 text-[color:var(--color-ink)]">
                SP
              </div>
              <div className="leading-tight">
                <p className="text-base font-800 tracking-tight">SafePass</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-fog)]">
                  Control de Aptitud · Faena
                </p>
              </div>
            </div>

            <div className="mt-16">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-semi)]">
                Evaluación cognitiva diaria
              </p>
              <h2 className="mt-3 text-4xl font-800 leading-[1.1] tracking-tight">
                Seguridad que<br />
                <span className="text-[color:var(--color-semi)]">protege</span> a tu equipo
              </h2>
              <p className="mt-5 text-sm leading-relaxed text-[color:var(--color-fog)]">
                Antes de ingresar a faena, verifica tu aptitud cognitiva con una evaluación de 5 pruebas en menos de 5 minutos. Anónimo, seguro y certificado.
              </p>
            </div>

            {/* Feature list */}
            <ul className="mt-10 space-y-3">
              {[
                { icon: "⏱", text: "Duración estimada: 4–5 minutos" },
                { icon: "🔒", text: "Sin RUT — solo ID de Ficha + PIN" },
                { icon: "✓", text: "Resultado inmediato con pase QR" },
              ].map((f) => (
                <li key={f.text} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] text-[13px]">
                    {f.icon}
                  </span>
                  <span className="text-sm text-[color:var(--color-fog)]">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Bottom note */}
          <div className="mt-auto pt-10">
            <div className="rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--color-fog)]">
                Sistema ISO 45001 · v2.4.1
              </p>
              <p className="mt-1 font-mono text-[10px] text-[color:var(--color-fog)]/50">
                Datos cifrados en tránsito · Minera Andina
              </p>
            </div>
          </div>
        </div>

        {/* ── Right column: form ── */}
        <div className="flex flex-1 flex-col px-6 py-10 lg:px-14 lg:py-14">

          {/* Brand — mobile only */}
          <div className="fade-up flex items-center gap-3 lg:hidden">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-[color:var(--color-semi)] font-mono text-lg font-800 text-[color:var(--color-ink)]">
              SP
            </div>
            <div className="leading-tight">
              <p className="text-base font-800 tracking-tight">SafePass</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
                Control de Aptitud · Faena
              </p>
            </div>
          </div>

          <div className="fade-up mt-12 lg:mt-0" style={{ animationDelay: "60ms" }}>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-semi)]">
              Ingreso de turno
            </p>
            <h1 className="mt-2 text-3xl font-800 tracking-tight lg:text-4xl">
              Identifícate para comenzar
            </h1>
            <p className="mt-2 text-sm text-[color:var(--color-fog)]">
              Ingresa tu <strong className="text-[color:var(--color-mist)]">ID de Ficha</strong> y tu{" "}
              <strong className="text-[color:var(--color-mist)]">PIN de 6 dígitos</strong> para acceder.
            </p>
          </div>

          {/* Ficha ID */}
          <label className="fade-up mt-8 block" style={{ animationDelay: "120ms" }}>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              ID de Ficha
            </span>
            <div className="relative mt-2">
              <input
                value={ficha}
                onChange={(e) => setFicha(e.target.value.toUpperCase())}
                placeholder="TRB-0000"
                inputMode="text"
                className="w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] px-4 py-4 font-mono text-2xl font-700 tracking-[0.15em] outline-none transition-colors placeholder:text-[color:var(--color-fog)]/40 focus:border-[color:var(--color-semi)]"
              />
              {fichaOk && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs font-700 text-[color:var(--color-apt)]">
                  ✓
                </span>
              )}
            </div>
          </label>

          {/* PIN numpad */}
          <div className="fade-up mt-6" style={{ animationDelay: "160ms" }}>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
              PIN de acceso (4 dígitos)
            </span>
            <div className={`mt-4 rounded-2xl border bg-[color:var(--color-steel)] p-5 transition-colors ${error ? "border-[color:var(--color-no)]" : "border-[color:var(--color-slate-line)]"}`}>
              {error && (
                <p className="mb-3 text-center font-mono text-xs font-700 uppercase tracking-wider text-[color:var(--color-no)]">
                  PIN incorrecto · intenta de nuevo
                </p>
              )}
              <NumPad pin={pin} onChange={setPin} />
            </div>
          </div>

          {/* Divider */}
          <div className="fade-up mt-6 flex items-center gap-4" style={{ animationDelay: "190ms" }}>
            <span className="h-px flex-1 bg-[color:var(--color-slate-line)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">o</span>
            <span className="h-px flex-1 bg-[color:var(--color-slate-line)]" />
          </div>

          {/* QR scan */}
          <button
            onClick={scan}
            disabled={scanning}
            className="fade-up mt-6 flex h-20 w-full items-center justify-center gap-4 rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] transition-colors hover:border-[color:var(--color-semi)] disabled:opacity-70"
            style={{ animationDelay: "220ms" }}
          >
            <div className={`relative grid h-12 w-12 place-items-center rounded-lg border-2 border-[color:var(--color-semi)] ${scanning ? "overflow-hidden" : ""}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="var(--color-mist)">
                <path d="M3 3h6v6H3V3Zm2 2v2h2V5H5Zm10-2h6v6h-6V3Zm2 2v2h2V5h-2ZM3 15h6v6H3v-6Zm2 2v2h2v-2H5Zm12-2h2v2h-2v-2Zm2 2h2v2h-2v-2Zm-2 2h2v2h-2v-2Zm-2-2h2v2h-2v-2Z" />
              </svg>
              {scanning && (
                <span className="absolute inset-x-0 top-0 h-0.5 bg-[color:var(--color-apt)] shadow-[0_0_8px_var(--color-apt)]" style={{ animation: "scan 1.2s linear infinite" }} />
              )}
            </div>
            <div className="text-left leading-tight">
              <p className="font-700 text-[color:var(--color-mist)]">{scanning ? "Escaneando…" : "Escanear credencial QR"}</p>
              <p className="font-mono text-[11px] text-[color:var(--color-fog)]">Acerca tu tarjeta al lector</p>
            </div>
          </button>

          <button
            disabled={!ready}
            onClick={handleLogin}
            className="fade-up mt-8 h-20 w-full rounded-2xl bg-[color:var(--color-semi)] text-lg font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[color:var(--color-steel-2)] disabled:text-[color:var(--color-fog)]"
            style={{ animationDelay: "260ms" }}
          >
            Iniciar evaluación
          </button>

          <button
            onClick={() => setForgot(true)}
            className="fade-up mx-auto mt-6 font-mono text-xs uppercase tracking-wider text-[color:var(--color-fog)] underline-offset-4 transition-colors hover:text-[color:var(--color-semi)] hover:underline"
            style={{ animationDelay: "300ms" }}
          >
            ¿Olvidaste tu ID o PIN?
          </button>
        </div>
      </div>

      {/* Forgot modal */}
      {forgot && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-6 backdrop-blur-sm" onClick={() => setForgot(false)}>
          <div
            className="scale-in w-full max-w-sm rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-800 tracking-tight">Recuperar acceso</h2>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--color-fog)]">
              Ingresa tu correo institucional y te enviaremos tu ID de Ficha y un PIN temporal.
            </p>
            <label className="mt-5 block">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
                Correo institucional
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="nombre@mineraandina.cl"
                className="mt-2 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-ink)] px-4 py-3.5 text-base outline-none transition-colors placeholder:text-[color:var(--color-fog)]/40 focus:border-[color:var(--color-semi)]"
              />
            </label>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setForgot(false)}
                className="h-14 flex-1 rounded-xl border border-[color:var(--color-slate-line)] font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:bg-[color:var(--color-steel-2)]"
              >
                Cancelar
              </button>
              <button
                onClick={sendRecovery}
                disabled={!email.includes("@")}
                className="h-14 flex-[1.4] rounded-xl bg-[color:var(--color-semi)] font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] disabled:bg-[color:var(--color-steel-2)] disabled:text-[color:var(--color-fog)]"
              >
                Enviar acceso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed inset-x-4 top-6 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-[color:var(--color-apt)]/40 bg-[color:var(--color-steel)] p-4 shadow-2xl" style={{ animation: "fade-up 0.4s cubic-bezier(0.22,1,0.36,1) both" }}>
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color:var(--color-apt)] text-sm font-800 text-[color:var(--color-ink)]">✓</span>
          <div className="leading-snug">
            <p className="text-sm font-700 text-[color:var(--color-mist)]">Correo enviado</p>
            <p className="mt-0.5 text-sm text-[color:var(--color-fog)]">
              Revisa tu correo institucional con tu ID y PIN temporal.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
