import { createHmac } from "node:crypto"
import argon2 from "argon2"

// Parámetros mínimos recomendados por OWASP para Argon2id (19 MiB, 2 iteraciones)
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

/**
 * Hash de PIN: Argon2id sobre HMAC-SHA256(PIN, PIN_PEPPER).
 * Un PIN de 6 dígitos tiene solo 10^6 combinaciones; el pepper (fuera de la BD)
 * impide un ataque de fuerza bruta offline si se filtra la base de datos.
 */
export class PinHasher {
  private dummyHash: Promise<string> | undefined

  constructor(private readonly pepper: string) {}

  hash(pin: string): Promise<string> {
    return argon2.hash(this.withPepper(pin), ARGON2_OPTIONS)
  }

  async verify(hash: string, pin: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, this.withPepper(pin))
    } catch {
      return false
    }
  }

  /** Mismo costo que verify() para usuarios inexistentes: evita enumerar fichas por tiempo de respuesta */
  async verifyAgainstDummy(pin: string): Promise<false> {
    this.dummyHash ??= this.hash("dummy-pin-for-timing")
    await this.verify(await this.dummyHash, pin)
    return false
  }

  private withPepper(pin: string): string {
    return createHmac("sha256", this.pepper).update(pin).digest("base64")
  }
}

/** PIN trivial: todos iguales (111111), secuencias (123456 / 654321) o patrones repetidos (121212, 123123) */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true
  const digits = [...pin].map(Number)
  const steps = digits.slice(1).map((d, i) => d - digits[i]!)
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true
  if (/^(\d{2})\1+$/.test(pin) || /^(\d{3})\1$/.test(pin)) return true
  return false
}
