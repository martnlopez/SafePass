import { z } from "zod"
import { SUPERVISOR_DECISIONS, TRAFFIC_LIGHTS } from "../types/domain.js"
import { BooleanQuery, PaginationQuery } from "./common.schema.js"

const Ms = z.number().int().min(100).max(3000)
const Count = z.number().int().min(0).max(500)

/** Métricas crudas de la prueba PVT-B enviadas por el tótem. El puntaje y el dictamen los calcula el servidor. */
export const CreateEvaluationBody = z
  .strictObject({
    meanLatencyMs: Ms,
    medianReactionTimeMs: Ms,
    omissions: Count,
    falseStarts: Count,
    totalStimuli: z.number().int().min(1).max(500),
    durationSeconds: z.number().int().min(30).max(900),
  })
  .refine((m) => m.omissions <= m.totalStimuli, {
    path: ["omissions"],
    message: "Las omisiones no pueden superar el total de estímulos",
  })
  // Plausibilidad PVT: el intervalo entre estímulos es de 2 a 10 s, así que una prueba de
  // N segundos presenta al menos N/10 estímulos y a lo sumo N/2
  .refine((m) => m.totalStimuli >= Math.ceil(m.durationSeconds / 10) && m.totalStimuli <= Math.ceil(m.durationSeconds / 2), {
    path: ["totalStimuli"],
    message: "La cantidad de estímulos no es coherente con la duración de la prueba",
  })
export type CreateEvaluationDto = z.infer<typeof CreateEvaluationBody>

const IsoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v))

export const ListEvaluationsQuery = PaginationQuery.extend({
  status: z.enum(TRAFFIC_LIGHTS).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  totemId: z.uuid().optional(),
  workerId: z.uuid().optional(),
  includeVoided: BooleanQuery.default(false),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { path: ["from"], message: "`from` debe ser anterior a `to`" })
export type ListEvaluationsDto = z.infer<typeof ListEvaluationsQuery>

export const ReviewEvaluationBody = z
  .strictObject({
    /** Ajuste del dictamen vigente (el dictamen del algoritmo se conserva) */
    status: z.enum(TRAFFIC_LIGHTS).optional(),
    decision: z.enum(SUPERVISOR_DECISIONS).optional(),
    note: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((b) => b.status !== undefined || b.decision !== undefined || b.note !== undefined, "Debes enviar al menos un campo")
  .refine((b) => b.status === undefined || b.note !== undefined, {
    path: ["note"],
    message: "Cambiar el dictamen exige una observación que lo justifique",
  })
export type ReviewEvaluationDto = z.infer<typeof ReviewEvaluationBody>

export const VoidEvaluationBody = z.strictObject({
  reason: z.string().trim().min(10, "Indica un motivo de al menos 10 caracteres").max(500),
})
export type VoidEvaluationDto = z.infer<typeof VoidEvaluationBody>
