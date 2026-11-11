import { z } from "zod"
import { APP_DECISIONS, BATTERY_KEYS } from "../types/app.js"

/** Aduana de entrada de la API de la app: cuerpos estrictos (campos de más → 400) */

const BatteryEntry = z.strictObject({
  key: z.enum(BATTERY_KEYS),
  name: z.string().min(1).max(60),
  detail: z.string().max(160),
  score: z.number().int().min(0).max(100),
})

/** Desglose de las 5 pruebas; el servidor recalcula puntaje y estado */
export const SubmitResultBody = z.strictObject({
  breakdown: z
    .array(BatteryEntry)
    .length(BATTERY_KEYS.length)
    .refine((items) => new Set(items.map((i) => i.key)).size === BATTERY_KEYS.length, "Cada prueba debe aparecer una vez"),
})

export const CreateDecisionBody = z.strictObject({
  workerId: z.uuid(),
  decision: z.enum(APP_DECISIONS),
  note: z.string().max(280).nullable().optional(),
})

/** Única actualización permitida por el trabajador: marcar la decisión como vista */
export const UpdateDecisionBody = z.strictObject({
  seen: z.literal(true),
})

export const PassValidationBody = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^SP-[0-9A-F]{6}$/, "Código de pase inválido (ej. SP-2AAE91)"),
})
