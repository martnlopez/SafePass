import { AppError } from "../errors/app-error.js"

/** La base propia del backend (DATABASE_URL) no está configurada en este servidor */
export class DatabaseNotConfiguredError extends AppError {
  constructor() {
    super(503, "DATABASE_NOT_CONFIGURED", "Esta función no está disponible en este servidor")
    this.name = "DatabaseNotConfiguredError"
  }
}

/**
 * Repositorio "apagado": cualquier operación responde 503. Permite desplegar el backend
 * solo con la API de la app (Supabase), sin la base PostgreSQL del tótem y del panel.
 */
export function unavailableRepository<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_target, prop) => {
      // No es una promesa: evita que `await repo` lo trate como thenable
      if (prop === "then") return undefined
      return async () => {
        throw new DatabaseNotConfiguredError()
      }
    },
  })
}
