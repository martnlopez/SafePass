import { api, ApiError } from "./api"
import { describeError, supabase } from "./supabase"

// Login por Ficha ID + PIN sobre Supabase Auth. Cada ficha es una cuenta con un
// email interno no enrutable (dominio reservado .invalid): el trabajador nunca lo ve.

export type AppRole = "worker" | "supervisor"

export interface WorkerProfile {
  id: string
  fichaId: string
  fullName: string
  position: string
  company: string | null
  shift: "Día" | "Noche"
  role: AppRole
}

export const fichaToEmail = (fichaId: string) => `${fichaId.trim().toLowerCase()}@safepass.invalid`

export type SignInResult =
  | { ok: true; profile: WorkerProfile }
  | { ok: false; reason: "credentials" | "inactive" | "network"; message: string }

/**
 * @param captchaToken token de Cloudflare Turnstile; obligatorio cuando el CAPTCHA está activo
 *   en Supabase (Authentication → Attack Protection). Supabase lo valida en el servidor.
 */
export async function signIn(fichaId: string, pin: string, captchaToken?: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: fichaToEmail(fichaId),
    password: pin,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  })
  if (error || !data.user) {
    if (/captcha/i.test(error?.message ?? "")) {
      return { ok: false, reason: "network", message: "La verificación de seguridad falló o venció. Espera un momento e inténtalo de nuevo." }
    }
    const network = /fetch|network/i.test(error?.message ?? "")
    return network
      ? { ok: false, reason: "network", message: describeError(error) }
      : { ok: false, reason: "credentials", message: "Ficha ID o PIN incorrectos" }
  }

  let profile: WorkerProfile | null
  try {
    profile = await fetchProfile()
  } catch (err) {
    // La API SafePass no respondió: no se deja una sesión a medias
    await supabase.auth.signOut()
    return { ok: false, reason: "network", message: (err as Error).message }
  }
  if (!profile) {
    await supabase.auth.signOut()
    return { ok: false, reason: "inactive", message: "Tu cuenta no está habilitada. Contacta a tu supervisor." }
  }
  return { ok: true, profile }
}

/**
 * Perfil del usuario autenticado, desde la API SafePass. null = cuenta inexistente o
 * desactivada; lanza ApiError si la API no responde.
 */
export async function fetchProfile(): Promise<WorkerProfile | null> {
  try {
    return await api<WorkerProfile>("/app/me")
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return null
    throw err
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
