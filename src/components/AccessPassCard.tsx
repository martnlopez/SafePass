import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { formatRemaining, isPassExpired, type AccessPass } from "../lib/pass"

// Pase de acceso: QR real (vía lib `qrcode`) + código de validación manual.
// El AccessPass se emite al presionar "Generar pase" (estado bloqueado antes),
// con un id/hash único + Ficha ID + timestamp, y
// expira a las 12 h — hoy solo visual/lógico, listo para validarse contra
// Backend/DB cuando exista.
export default function AccessPassCard({
  pass,
  fichaId,
  accentHex,
}: {
  pass: AccessPass | null
  fichaId: string
  accentHex: string
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!pass) return
    let cancelled = false
    QRCode.toDataURL(pass.payload, {
      width: 176,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0b101d", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQrUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [pass])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!pass) {
    return (
      <div className="flex flex-col items-center">
        <div className="grid h-[208px] w-[208px] place-items-center rounded-xl border border-dashed border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] p-6 text-center">
          <div>
            <span className="text-3xl">🔒</span>
            <p className="mt-3 text-xs leading-relaxed text-[color:var(--color-fog)]">
              Presiona el botón para emitir tu pase de acceso validado
            </p>
          </div>
        </div>
      </div>
    )
  }

  const expired = isPassExpired(pass, now)

  return (
    <div className="flex flex-col items-center">
      <div
        className="rounded-xl border p-4"
        style={{ background: expired ? "var(--color-steel-2)" : "#ffffff", borderColor: `${accentHex}66` }}
      >
        {expired ? (
          <div className="grid h-[176px] w-[176px] place-items-center text-center">
            <p className="font-mono text-xs font-700 uppercase tracking-wider text-[color:var(--color-no)]">
              QR expirado
            </p>
          </div>
        ) : qrUrl ? (
          <img src={qrUrl} alt={`Código QR de acceso ${pass.code}`} width={176} height={176} />
        ) : (
          <div className="grid h-[176px] w-[176px] place-items-center">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-fog)]">
              Generando QR…
            </span>
          </div>
        )}
      </div>

      <p className="mt-4 font-mono text-sm font-600 text-[color:var(--color-mist)]">
        PASE-{fichaId} · {expired ? "Expirado" : `Válido ${formatRemaining(pass, now)} más`}
      </p>

      {/* Código de validación manual: respaldo si falla la cámara del lector */}
      <div className="mt-3 rounded-lg border border-dashed border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] px-5 py-3 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Código de validación manual
        </p>
        <p className="mt-1 font-mono text-2xl font-800 tracking-[0.2em] text-[color:var(--color-semi)]">
          {pass.code}
        </p>
      </div>
    </div>
  )
}
