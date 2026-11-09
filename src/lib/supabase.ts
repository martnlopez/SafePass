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

export const supabase = createClient(url, key, {
  auth: {
    // Dispositivo compartido: la sesión vive solo en memoria y se pierde al recargar
    // o cerrar la pestaña, así nadie queda con la sesión de otro trabajador abierta.
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

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
  }
  if (KNOWN[code]) return KNOWN[code]
  if (/fetch|network|Failed to fetch/i.test(code)) return "Sin conexión con el servidor. Revisa la red e inténtalo de nuevo."
  // Errores desconocidos: mensaje genérico (no exponer nombres de tablas ni detalles internos)
  return "Ocurrió un error inesperado. Inténtalo de nuevo o avisa a tu supervisor."
}
