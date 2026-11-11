import type { AppUser } from "./app.js"
import type { Principal, TotemDevice } from "./auth.js"

declare global {
  namespace Express {
    interface Request {
      /** Identidad resuelta por el middleware `authenticate` */
      auth?: Principal
      /** Dispositivo resuelto por el middleware `requireTotemKey` */
      totem?: TotemDevice
      /** Usuario de la app (token de Supabase) resuelto por `authenticateAppUser` */
      appUser?: AppUser
    }
  }
}

export {}
