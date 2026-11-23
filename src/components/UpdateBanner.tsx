/** Aviso de versión nueva para pantallas con sesión abierta: actualizar obliga a volver a ingresar */
export default function UpdateBanner({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-xl border border-[color:var(--color-semi)]/50 bg-[color:var(--color-steel)] px-4 py-3 shadow-lg"
    >
      <p className="text-sm text-[color:var(--color-mist)]">
        Hay una versión nueva de SafePass.
        <span className="block font-mono text-[11px] text-[color:var(--color-fog)]">
          Al actualizar tendrás que volver a ingresar.
        </span>
      </p>
      <button
        onClick={onUpdate}
        className="shrink-0 rounded-lg bg-[color:var(--color-semi)] px-3 py-2 font-mono text-xs font-700 uppercase tracking-wider text-[color:var(--color-ink)] transition-colors hover:opacity-90"
      >
        Actualizar
      </button>
    </div>
  )
}
