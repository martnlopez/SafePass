import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

// CAPTCHA de Cloudflare Turnstile (normalmente invisible para la persona). Frena a los
// programas que prueban PIN en masa contra el inicio de sesión. Supabase Auth valida el
// token del lado del servidor; aquí solo se obtiene y se entrega.

/** Clave pública del sitio. Sin ella el CAPTCHA queda apagado y el login funciona como antes. */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ""
export const captchaEnabled = TURNSTILE_SITE_KEY.length > 0

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      "expired-callback": () => void
      "error-callback": (code?: string) => void
      theme?: "light" | "dark" | "auto"
      language?: string
    },
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile no disponible")))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error("No se pudo cargar la verificación de seguridad"))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export interface TurnstileHandle {
  /** Pide un token nuevo (cada token sirve para un solo intento de inicio de sesión) */
  reset(): void
}

export const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void; onError?: (msg: string) => void }>(
  function Turnstile({ onToken, onError }, ref) {
    const container = useRef<HTMLDivElement>(null)
    const widgetId = useRef<string | null>(null)
    // Callbacks en refs: el widget se crea una sola vez aunque cambien entre renders
    const tokenCb = useRef(onToken)
    const errorCb = useRef(onError)
    tokenCb.current = onToken
    errorCb.current = onError

    useImperativeHandle(ref, () => ({
      reset() {
        tokenCb.current(null)
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
      },
    }))

    useEffect(() => {
      if (!captchaEnabled) return
      let cancelled = false
      loadTurnstile()
        .then((api) => {
          if (cancelled || !container.current) return
          widgetId.current = api.render(container.current, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: "dark",
            language: "es",
            callback: (token) => tokenCb.current(token),
            "expired-callback": () => tokenCb.current(null),
            "error-callback": (code) => {
              tokenCb.current(null)
              const hint = code?.startsWith("1102") ? " El dominio no está autorizado en el widget de Cloudflare." : ""
              errorCb.current?.(`No se pudo completar la verificación de seguridad (código ${code ?? "desconocido"}).${hint}`)
            },
          })
        })
        .catch((err: Error) => errorCb.current?.(err.message))
      return () => {
        cancelled = true
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }, [])

    if (!captchaEnabled) return null
    return <div ref={container} className="mt-6 flex min-h-[65px] justify-center" />
  },
)
