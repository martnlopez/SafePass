import { z } from "zod"
import { FichaId, Pin } from "./common.schema.js"

/** Mismo formulario para el panel (staff) y para abrir sesión en el tótem */
export const LoginBody = z.strictObject({
  fichaId: FichaId,
  pin: Pin,
})
export type LoginDto = z.infer<typeof LoginBody>
