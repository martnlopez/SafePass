import { useEffect, useState } from "react"

/** Cuenta regresiva hasta un instante absoluto (ms): segundos restantes + reloj mm:ss */
export function useCountdown(until: number) {
  const remaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000))
  const [left, setLeft] = useState(remaining)

  useEffect(() => {
    setLeft(remaining())
    const id = setInterval(() => setLeft(remaining()), 500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until])

  const mm = String(Math.floor(left / 60)).padStart(2, "0")
  const ss = String(left % 60).padStart(2, "0")
  return { left, clock: `${mm}:${ss}` }
}
