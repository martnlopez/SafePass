import { useCallback } from "react"
import { useRegisterSW } from "virtual:pwa-register/react"

/** Cada cuánto se consulta si hay una versión nueva (el tótem puede pasar días sin recargarse) */
const UPDATE_CHECK_MS = 10 * 60_000

export interface AppUpdate {
  /** Hay una versión nueva descargada, esperando a que se aplique */
  updateReady: boolean
  /** Activa la versión nueva y recarga la página */
  applyUpdate: () => void
}

/**
 * Actualización controlada de la app instalada (PWA). La versión nueva se descarga en
 * segundo plano y no se aplica sola: quien llama decide cuándo es seguro recargar.
 * Usar una sola vez (en App).
 */
export function useAppUpdate(): AppUpdate {
  const {
    needRefresh: [updateReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        // Sin señal no hay nada que consultar; se reintenta en la próxima vuelta
        if (navigator.onLine) void registration.update().catch(() => undefined)
      }, UPDATE_CHECK_MS)
    },
  })

  const applyUpdate = useCallback(() => void updateServiceWorker(true), [updateServiceWorker])
  return { updateReady, applyUpdate }
}
