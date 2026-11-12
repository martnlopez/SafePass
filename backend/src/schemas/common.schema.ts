import { z } from "zod"

export const IdParams = z.object({
  id: z.uuid({ message: "El id debe ser un UUID válido" }),
})
