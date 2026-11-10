import { STATUS_META } from "../lib/data"
import type { AccessPass } from "../lib/pass"
import AccessPassCard from "./AccessPassCard"

/** Trabajador que vuelve a iniciar sesión con un pase aún vigente */
export default function ActivePassView({
  pass,
  fichaId,
  onExit,
}: {
  pass: AccessPass
  fichaId: string
  onExit: () => void
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--color-ink)] p-6">
      <div className="fade-up flex w-full max-w-md flex-col items-center rounded-2xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel)] p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-fog)]">
          Pase de acceso a faena
        </p>
        <h1 className="mt-2 text-2xl font-800 tracking-tight text-white">Tienes un pase vigente</h1>
        <p className="mt-1 text-sm text-[color:var(--color-fog)]">Muéstralo a tu supervisor al ingresar.</p>
        <div className="mt-5">
          <AccessPassCard pass={pass} fichaId={fichaId} accentHex={STATUS_META.apto.hex} />
        </div>
        <button
          onClick={onExit}
          className="mt-6 h-14 w-full rounded-xl border border-[color:var(--color-slate-line)] bg-[color:var(--color-steel-2)] font-700 uppercase tracking-wide text-[color:var(--color-mist)] transition-colors hover:border-[color:var(--color-fog)]"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
