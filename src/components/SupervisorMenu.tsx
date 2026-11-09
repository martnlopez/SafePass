import SupervisorShell, { MenuCard } from "./SupervisorShell"

export default function SupervisorMenu({
  onDashboard,
  onValidate,
  onLogout,
}: {
  onDashboard: () => void
  onValidate: () => void
  onLogout: () => void
}) {
  return (
    <SupervisorShell action={{ label: "Cerrar sesión", onClick: onLogout }}>
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-[color:var(--color-semi)]">
        Menú principal
      </p>
      <h1 className="mt-2 text-3xl font-800 tracking-tight">¿Qué deseas hacer?</h1>
      <div className="mt-8 space-y-4">
        <MenuCard
          icon="📊"
          title="Ver dashboard"
          desc="Resumen de aptitud del turno, métricas y lista de trabajadores."
          onClick={onDashboard}
        />
        <MenuCard
          icon="✓"
          title="Validar pase de entrada"
          desc="Verifica el pase de acceso de un operador."
          onClick={onValidate}
        />
      </div>
    </SupervisorShell>
  )
}
