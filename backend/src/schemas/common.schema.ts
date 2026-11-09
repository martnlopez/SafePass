import { z } from "zod"

export const IdParams = z.object({
  id: z.uuid({ message: "El id debe ser un UUID válido" }),
})

/** Paginación obligatoria: siempre hay página y tamaño máximo (anti-scraping) */
export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

/** Booleano en query string: solo "true" / "false" (z.coerce.boolean trataría "false" como true) */
export const BooleanQuery = z.enum(["true", "false"]).transform((v) => v === "true")

export const FichaId = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}-\d{4}$/, "Formato de Ficha ID inválido (ej. TRB-0512)")

export const Pin = z.string().regex(/^\d{6}$/, "El PIN debe tener exactamente 6 dígitos")
