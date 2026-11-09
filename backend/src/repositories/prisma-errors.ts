import { RecordNotFoundError, UniqueConstraintError } from "../errors/app-error.js"

/** Traduce errores conocidos de Prisma a errores de dominio (los services no dependen de Prisma) */
export function translatePrismaError(err: unknown): never {
  if (typeof err === "object" && err !== null && "code" in err) {
    const { code, meta } = err as { code?: unknown; meta?: Record<string, unknown> }
    if (code === "P2002") throw new UniqueConstraintError(extractFields(meta))
    if (code === "P2025") throw new RecordNotFoundError()
  }
  throw err
}

function extractFields(meta: Record<string, unknown> | undefined): string[] {
  const target = meta?.["target"]
  if (Array.isArray(target)) return target.map(String)
  if (typeof target === "string") return [target]
  // Con driver adapters el detalle viene en driverAdapterError.cause.constraint.fields
  const fields = (meta?.["driverAdapterError"] as { cause?: { constraint?: { fields?: unknown } } } | undefined)?.cause
    ?.constraint?.fields
  return Array.isArray(fields) ? fields.map(String) : []
}
