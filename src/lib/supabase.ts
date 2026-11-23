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

/** Códigos de error del servidor (reglas de la base y API SafePass) → mensaje para la persona */
const ERROR_MESSAGES: Record<string, string> = {
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
  EVALUATION_SESSION_EXPIRED: "El resultado no se pudo enviar a tiempo (el test duró más de 30 minutos o pasaron más de 2 horas sin señal). Vuelve a iniciar la evaluación.",
  EVALUATION_TOO_FAST: "La evaluación terminó demasiado rápido para ser válida. Vuelve a rendirla con calma.",
  TOO_MANY_SESSIONS: "Demasiados intentos en la última hora. Avisa a tu supervisor.",
  SELF_DECISION_NOT_ALLOWED: "No puedes registrar una decisión sobre tu propia evaluación. Debe hacerlo otro supervisor.",
  NOT_ALLOWED: "No tienes permiso para realizar esta acción.",
  // API SafePass (backend)
  INVALID_SESSION: "Tu sesión venció. Vuelve a ingresar con tu Ficha ID y PIN.",
  MISSING_TOKEN: "Tu sesión venció. Vuelve a ingresar con tu Ficha ID y PIN.",
  NOT_AUTHENTICATED: "Tu sesión venció. Vuelve a ingresar con tu Ficha ID y PIN.",
  UPSTREAM_UNAVAILABLE: "El servicio de datos no responde. Inténtalo de nuevo en unos segundos.",
  APP_API_DISABLED: "El servidor SafePass no está configurado. Avisa al administrador.",
  RATE_LIMITED: "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
  VALIDATION_ERROR: "Los datos enviados no son válidos.",
  NETWORK: "Sin conexión con el servidor SafePass. Revisa la red e inténtalo de nuevo.",
  TIMEOUT: "El servidor tardó demasiado en responder. Revisa la señal e inténtalo de nuevo.",
}

/**
 * Error transitorio de red (sin señal, timeout, corte a mitad): reintentar es razonable.
 * Los errores de reglas del servidor (códigos en MAYÚSCULAS) no se reintentan.
 */
export function isTransientError(error: unknown): boolean {
  const raw = (error as { message?: string; name?: string; status?: number } | null) ?? {}
  // ApiError de la API SafePass: 0 = sin red; 502/503/504 = servicio caído o lento
  if (typeof raw.status === "number" && [0, 502, 503, 504].includes(raw.status)) return true
  return /fetch|network|timed? ?out|timeout|abort/i.test(`${raw.name ?? ""} ${raw.message ?? ""}`)
}

/** Mensaje en español para un código de error del servidor (null si no se conoce) */
export function messageForCode(code: string): string | null {
  return ERROR_MESSAGES[code] ?? null
}

/** Mensaje legible a partir de un error de Supabase/PostgREST o de las reglas del servidor */
export function describeError(error: unknown): string {
  const raw = (error as { message?: string; code?: string } | null) ?? {}
  const code = raw.code && ERROR_MESSAGES[raw.code] ? raw.code : (raw.message ?? "")
  const known = ERROR_MESSAGES[code]
  if (known) return known
  // ApiError de la API SafePass: su mensaje ya está pensado para la persona
  if ((error as { name?: string } | null)?.name === "ApiError" && raw.message) return raw.message
  if (/timed? ?out|timeout|abort/i.test(code)) return "El servidor tardó demasiado en responder. Revisa la señal e inténtalo de nuevo."
  if (/fetch|network|Failed to fetch/i.test(code)) return "Sin conexión con el servidor. Revisa la red e inténtalo de nuevo."
  // Errores desconocidos: mensaje genérico (no exponer nombres de tablas ni detalles internos)
  return "Ocurrió un error inesperado. Inténtalo de nuevo o avisa a tu supervisor."
}
