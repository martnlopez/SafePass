import type { AppUser } from "./app.js"

declare global {
  namespace Express {
    interface Request {
      /** Usuario de la app (token de Supabase) resuelto por `authenticateAppUser` */
      appUser?: AppUser
    }
  }
}

export {}
