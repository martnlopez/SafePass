import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const VERSION = "v1"

/**
 * Cifrado de campos sensibles a nivel de aplicación.
 *  - encrypt/decrypt: AES-256-GCM con IV aleatorio y AAD = contexto del campo
 *    (un texto cifrado de "worker.rut" no se puede descifrar como otro campo).
 *  - blindIndex: HMAC-SHA256 con una clave distinta, para unicidad/búsqueda
 *    exacta sin guardar el dato en claro.
 */
export class FieldCipher {
  private readonly encKey: Buffer
  private readonly indexKey: Buffer

  constructor(encryptionKeyB64: string, blindIndexKeyB64: string) {
    this.encKey = Buffer.from(encryptionKeyB64, "base64")
    this.indexKey = Buffer.from(blindIndexKeyB64, "base64")
    if (this.encKey.length !== 32 || this.indexKey.length !== 32) {
      throw new Error("Las claves de cifrado deben ser de 32 bytes")
    }
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, this.encKey, iv)
    cipher.setAAD(Buffer.from(context, "utf8"))
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
  }

  decrypt(payload: string, context: string): string {
    const [version, iv, tag, ciphertext] = payload.split(".")
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error("Formato de dato cifrado no soportado")
    }
    const decipher = createDecipheriv(ALGORITHM, this.encKey, Buffer.from(iv, "base64url"))
    decipher.setAAD(Buffer.from(context, "utf8"))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")
  }

  blindIndex(value: string, context: string): string {
    return createHmac("sha256", this.indexKey).update(`${context}:${value}`).digest("hex")
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Comparación en tiempo constante de dos hashes hex */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex")
  const bb = Buffer.from(b, "hex")
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb)
}

/** Secreto aleatorio de alta entropía para dispositivos (tótems) */
export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64url")
}
