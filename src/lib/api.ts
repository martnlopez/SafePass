import { messageForCode, supabase } from "./supabase"

// Cliente de la API SafePass (backend en ./backend). La identidad es la sesión de Supabase
// Auth: su token viaja como Bearer y el backend actúa en Supabase con esa misma identidad.

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000/api/v1").replace(/\/+$/, "")
/** Timeout explícito (prompt de arquitectura §7.6) */
const REQUEST_TIMEOUT_MS = 15_000

/** Error de la API con el código de máquina del contrato (ver docs/CONTRATO-API.md) */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Código HTTP; 0 = no hubo respuesta (sin red o timeout) */
    readonly status: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError("INVALID_SESSION", messageForCode("INVALID_SESSION") ?? "Sesión vencida", 401)
  return token
}

/** Llama a la API; lanza ApiError con un mensaje en español listo para mostrar */
export async function api<T>(path: string, init: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {}): Promise<T> {
  const token = await accessToken()
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : null,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError"
    const code = timeout ? "TIMEOUT" : "NETWORK"
    throw new ApiError(code, messageForCode(code) ?? "Sin conexión", 0)
  }

  if (res.status === 204) return undefined as T
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) {
    const code = body?.error?.code ?? `HTTP_${res.status}`
    // Mensaje propio si el código es conocido; si no, el del servidor (pensado para personas)
    const message = messageForCode(code) ?? body?.error?.message ?? "Ocurrió un error inesperado. Inténtalo de nuevo."
    throw new ApiError(code, message, res.status)
  }
  return body as T
}
