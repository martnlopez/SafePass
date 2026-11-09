import { useEffect, useRef, useState } from "react"
import jsQR from "jsqr"

// Visor de cámara en vivo (getUserMedia) que decodifica QR con jsQR.
// Compartido por la validación de pases y el escaneo de credencial.
export default function CameraScanner({
  onScan,
  onCancel,
  cancelLabel = "Cancelar",
}: {
  onScan: (data: string) => void
  onCancel: () => void
  cancelLabel?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement("canvas")
    setError(false)

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const tick = () => {
          if (stopped) return
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!
            ctx.drawImage(video, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height)
            if (code?.data) {
              stopped = true
              stream?.getTracks().forEach((t) => t.stop())
              onScanRef.current(code.data)
              return
            }
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        if (!stopped) setError(true)
      }
    }
    start()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt])

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-2xl border border-[color:var(--color-no)]/40 bg-[color:var(--color-no)]/10 p-5 text-center">
          <p className="text-sm font-700 text-[color:var(--color-no)]">No se pudo acceder a la cámara</p>
          <p className="mt-1 text-xs text-[color:var(--color-fog)]">
            Revisa los permisos del navegador o verifica que el dispositivo tenga cámara.
          </p>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-4 h-12 w-full rounded-xl bg-[color:var(--color-semi)] font-800 uppercase tracking-wide text-[color:var(--color-ink)] transition-all hover:bg-[color:var(--color-semi-dim)] active:scale-[0.99]"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-[color:var(--color-slate-line)] bg-black">
          <video ref={videoRef} playsInline muted className="aspect-square w-full object-cover" />
          <span
            className="absolute inset-x-0 top-0 h-0.5 bg-[color:var(--color-apt)] shadow-[0_0_8px_var(--color-apt)]"
            style={{ animation: "scan 2s linear infinite" }}
          />
        </div>
      )}
      <button
        onClick={onCancel}
        className="h-12 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] text-sm font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)]"
      >
        {error ? cancelLabel : "Cerrar / Cancelar"}
      </button>
    </div>
  )
}
