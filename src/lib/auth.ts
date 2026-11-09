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

export async function signIn(fichaId: string, pin: string): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: fichaToEmail(fichaId), password: pin })
  if (error || !data.user) {
    const network = /fetch|network/i.test(error?.message ?? "")
    return network
      ? { ok: false, reason: "network", message: describeError(error) }
      : { ok: false, reason: "credentials", message: "Ficha ID o PIN incorrectos" }
  }

  const profile = await fetchProfile(data.user.id)
  if (!profile) {
    await supabase.auth.signOut()
    return { ok: false, reason: "inactive", message: "Tu cuenta no está habilitada. Contacta a tu supervisor." }
  }
  return { ok: true, profile }
}

export async function fetchProfile(userId: string): Promise<WorkerProfile | null> {
  const { data, error } = await supabase
    .from("workers")
    .select("id, ficha_id, full_name, position, company, shift, app_role, active")
    .eq("id", userId)
    .maybeSingle()
  if (error || !data || !data.active) return null
  return {
    id: data.id,
    fichaId: data.ficha_id,
    fullName: data.full_name,
    position: data.position,
    company: data.company,
    shift: data.shift,
    role: data.app_role,
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
