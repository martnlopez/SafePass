import { z } from "zod"
import { isWeakPin } from "../lib/pin.js"
import { isValidRut, normalizeRut } from "../lib/rut.js"
import { CREWS, ROLES } from "../types/domain.js"
import { BooleanQuery, FichaId, PaginationQuery, Pin } from "./common.schema.js"

const NewPin = Pin.refine((pin) => !isWeakPin(pin), "PIN demasiado predecible (evita 123456, 111111, 121212…)")

const Rut = z.string().trim().refine(isValidRut, "RUT inválido").transform(normalizeRut)

const FullName = z.string().trim().min(3).max(120)
const Position = z.string().trim().min(2).max(80)
const Company = z.string().trim().min(2).max(120)

// strictObject: rechaza campos no declarados (evita asignación masiva de pinHash, pseudonymId, etc.)
export const CreateWorkerBody = z.strictObject({
  fichaId: FichaId,
  rut: Rut,
  fullName: FullName,
  position: Position,
  company: Company.optional(),
  crew: z.enum(CREWS),
  role: z.enum(ROLES).default("OPERATOR"),
  pin: NewPin,
})
export type CreateWorkerDto = z.infer<typeof CreateWorkerBody>

export const UpdateWorkerBody = z
  .strictObject({
    fullName: FullName.optional(),
    position: Position.optional(),
    company: Company.nullable().optional(),
    crew: z.enum(CREWS).optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    /** Restablece el PIN y desbloquea la cuenta */
    pin: NewPin.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), "Debes enviar al menos un campo a actualizar")
export type UpdateWorkerDto = z.infer<typeof UpdateWorkerBody>

export const ListWorkersQuery = PaginationQuery.extend({
  crew: z.enum(CREWS).optional(),
  role: z.enum(ROLES).optional(),
  includeInactive: BooleanQuery.default(false),
})
export type ListWorkersDto = z.infer<typeof ListWorkersQuery>
