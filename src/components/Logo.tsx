// Alto fijo + ancho automático: conserva la relación de aspecto del PNG (396×360).
const SIZES = {
  sm: "h-12 lg:h-14",
  md: "h-14",
  lg: "h-16",
} as const

export default function Logo({ size = "sm" }: { size?: keyof typeof SIZES }) {
  return (
    <img
      src="/logo_safepass_.png"
      alt="SafePass"
      className={`w-auto max-h-16 shrink-0 object-contain ${SIZES[size]}`}
    />
  )
}
