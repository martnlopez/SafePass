// Identidades autenticadas que pueden llegar a un controller

/** Roles de acceso a la API (RBAC) */
export type AccessRole = "TOTEM" | "SUPERVISOR" | "ADMIN"

/** Personal HSE autenticado desde el panel (JWT staff) */
export interface StaffPrincipal {
  kind: "staff"
  role: "SUPERVISOR" | "ADMIN"
  workerId: string
  fichaId: string
}

/**
 * Sesión de evaluación en un tótem (JWT de corta duración).
 * Solo lleva el seudónimo del trabajador: el token no identifica a la persona.
 */
export interface TotemSessionPrincipal {
  kind: "totem"
  role: "TOTEM"
  subjectId: string
  totemId: string
  sessionId: string
}

export type Principal = StaffPrincipal | TotemSessionPrincipal

/** Dispositivo autenticado con su clave (X-Totem-Key) */
export interface TotemDevice {
  id: string
  name: string
}
