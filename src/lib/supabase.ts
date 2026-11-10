import { createClient } from "@supabase/supabase-js"

// Cliente único de Supabase. La clave publicable puede ir en el navegador:
// los datos los protegen las reglas RLS y las funciones del servidor
// (ver supabase/migrations).

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    "Falta la configuración de Supabase: define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local (ver .env.example).",
  )
}

// Timeout explícito en toda llamada remota (prompt de arquitectura §7.6): con mala señal
// una petición colgada no deja al trabajador esperando indefinidamente.
const REQUEST_TIMEOUT_MS = 15_000

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init?.signal && "any" in AbortSignal ? AbortSignal.any([init.signal, timeout]) : (init?.signal ?? timeout)
  return fetch(input, { ...init, signal })
}

export const supabase = createClient(url, key, {
  global: { fetch: fetchWithTimeout },
  auth: {
    // Dispositivo compartido: la sesión vive solo en memoria y se pierde al recargar
    // o cerrar la pestaña, así nadie queda con la sesión de otro trabajador abierta.
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/**
 * Error transitorio de red (sin señal, timeout, corte a mitad): reintentar es razonable.
 * Los errores de reglas del servidor (códigos en MAYÚSCULAS) no se reintentan.
 */
export function isTransientError(error: unknown): boolean {
  const raw = (error as { message?: string; name?: string } | null) ?? {}
  return /fetch|network|timed? ?out|timeout|abort/i.test(`${raw.name ?? ""} ${raw.message ?? ""}`)
}

/** Mensaje legible a partir de un error de Supabase/PostgREST o de las reglas del servidor */
export function describeError(error: unknown): string {
  const raw = (error as { message?: string; hint?: string } | null) ?? {}
  const code = raw.message ?? ""
  const KNOWN: Record<string, string> = {
    SUPERVISOR_AUTHORIZATION_REQUIRED: "Tu último resultado requiere una indicación de tu supervisor.",
    RETEST_COOLDOWN: "Debes completar el descanso preventivo de 5 minutos.",
    RETEST_REST_PENDING: "El descanso indicado por tu supervisor aún no termina.",
    PASS_NOT_ALLOWED: "No hay un resultado APTO vigente ni un pase autorizado por tu supervisor.",
    DECISION_NOT_FOUND: "La decisión ya no está disponible.",
    INVALID_BREAKDOWN: "El resultado de la evaluación llegó incompleto. Vuelve a rendir la evaluación.",
    EVALUATION_TOO_SOON: "Ya registraste una evaluación hace menos de 2 minutos.",
    ACCOUNT_DISABLED: "Tu cuenta no está habilitada. Contacta a tu supervisor.",
    EVALUATION_SESSION_INVALID: "La sesión de evaluación ya no es válida. Vuelve a iniciar la evaluación.",
    EVALUATION_SESSION_REQUIRED: "La sesión de evaluación ya no es válida. Vuelve a iniciar la evaluación.",
    EVALUATION_SESSION_EXPIRED: "La evaluación tardó demasiado (más de 30 minutos). Vuelve a iniciarla.",
    EVALUATION_TOO_FAST: "La evaluación terminó demasiado rápido para ser válida. Vuelve a rendirla con calma.",
    TOO_MANY_SESSIONS: "Demasiados intentos en la última hora. Avisa a tu supervisor.",
    SELF_DECISION_NOT_ALLOWED: "No puedes registrar una decisión sobre tu propia evaluación. Debe hacerlo otro supervisor.",
    NOT_ALLOWED: "No tienes permiso para realizar esta acción.",
  }
  if (KNOWN[code]) return KNOWN[code]
  if (/timed? ?out|timeout|abort/i.test(code)) return "El servidor tardó demasiado en responder. Revisa la señal e inténtalo de nuevo."
  if (/fetch|network|Failed to fetch/i.test(code)) return "Sin conexión con el servidor. Revisa la red e inténtalo de nuevo."
  // Errores desconocidos: mensaje genérico (no exponer nombres de tablas ni detalles internos)
  return "Ocurrió un error inesperado. Inténtalo de nuevo o avisa a tu supervisor."
}
