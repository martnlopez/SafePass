import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { FieldCipher, safeEqualHex, sha256Hex } from "../src/lib/crypto.js"
import { isWeakPin, PinHasher } from "../src/lib/pin.js"
import { formatRut, isValidRut, maskRut, normalizeRut } from "../src/lib/rut.js"
import { computePvtScore, scoreToTrafficLight } from "../src/services/scoring.service.js"
import { METRICS } from "./helpers/test-app.js"

describe("scoring PVT-B", () => {
  it("clasifica los tramos 80-100 / 60-79 / 0-59", () => {
    expect(scoreToTrafficLight(100)).toBe("VERDE")
    expect(scoreToTrafficLight(80)).toBe("VERDE")
    expect(scoreToTrafficLight(79)).toBe("AMARILLO")
    expect(scoreToTrafficLight(60)).toBe("AMARILLO")
    expect(scoreToTrafficLight(59)).toBe("ROJO")
    expect(scoreToTrafficLight(0)).toBe("ROJO")
  })

  it("calcula puntaje y dictamen desde las métricas crudas", () => {
    expect(computePvtScore(METRICS.verde)).toMatchObject({ score: 92, status: "VERDE", version: "pvtb-1.0" })
    expect(computePvtScore(METRICS.amarillo)).toMatchObject({ score: 71, status: "AMARILLO" })
    expect(computePvtScore(METRICS.rojo)).toMatchObject({ score: 51, status: "ROJO" })
  })

  it("mantiene el puntaje dentro de 0-100 en casos extremos", () => {
    const best = { meanLatencyMs: 150, medianReactionTimeMs: 150, omissions: 0, falseStarts: 0, totalStimuli: 35, durationSeconds: 180 }
    const worst = { meanLatencyMs: 2000, medianReactionTimeMs: 2000, omissions: 35, falseStarts: 40, totalStimuli: 35, durationSeconds: 180 }
    expect(computePvtScore(best).score).toBe(100)
    expect(computePvtScore(worst).score).toBe(0)
  })
})

describe("RUT", () => {
  it("valida el dígito verificador (módulo 11)", () => {
    expect(isValidRut("12.345.678-5")).toBe(true)
    expect(isValidRut("11111111-1")).toBe(true)
    expect(isValidRut("12.345.678-9")).toBe(false)
    expect(isValidRut("abc")).toBe(false)
  })

  it("normaliza, formatea y enmascara", () => {
    expect(normalizeRut("12.345.678-5")).toBe("12345678-5")
    expect(normalizeRut("012345678-5")).toBe("12345678-5")
    expect(formatRut("12345678-5")).toBe("12.345.678-5")
    expect(maskRut("12345678-5")).toBe("**.***.678-5")
    expect(maskRut("9876543-3")).toBe("*.***.543-3")
  })
})

describe("FieldCipher (AES-256-GCM + índice ciego)", () => {
  const cipher = new FieldCipher(randomBytes(32).toString("base64"), randomBytes(32).toString("base64"))

  it("cifra y descifra con IV aleatorio", () => {
    const a = cipher.encrypt("12345678-5", "worker.rut")
    const b = cipher.encrypt("12345678-5", "worker.rut")
    expect(a).not.toBe(b)
    expect(a).not.toContain("12345678")
    expect(cipher.decrypt(a, "worker.rut")).toBe("12345678-5")
  })

  it("rechaza descifrar con otro contexto (AAD) o datos alterados", () => {
    const payload = cipher.encrypt("dato", "worker.rut")
    expect(() => cipher.decrypt(payload, "evaluation.supervisor_note")).toThrow()
    const tampered = payload.slice(0, -2) + (payload.endsWith("A") ? "BB" : "AA")
    expect(() => cipher.decrypt(tampered, "worker.rut")).toThrow()
  })

  it("índice ciego determinista y separado por contexto", () => {
    expect(cipher.blindIndex("12345678-5", "worker.rut")).toBe(cipher.blindIndex("12345678-5", "worker.rut"))
    expect(cipher.blindIndex("12345678-5", "worker.rut")).not.toBe(cipher.blindIndex("12345678-5", "otro"))
  })

  it("compara hashes en tiempo constante", () => {
    expect(safeEqualHex(sha256Hex("a"), sha256Hex("a"))).toBe(true)
    expect(safeEqualHex(sha256Hex("a"), sha256Hex("b"))).toBe(false)
    expect(safeEqualHex("", "")).toBe(false)
  })
})

describe("PIN", () => {
  it("detecta PIN triviales", () => {
    for (const pin of ["111111", "123456", "654321", "012345", "121212", "123123"]) expect(isWeakPin(pin)).toBe(true)
    for (const pin of ["480271", "902614", "375019"]) expect(isWeakPin(pin)).toBe(false)
  })

  it("Argon2id con pepper: el hash depende del pepper", async () => {
    const hasher = new PinHasher(randomBytes(32).toString("base64url"))
    const other = new PinHasher(randomBytes(32).toString("base64url"))
    const hash = await hasher.hash("480271")
    expect(hash.startsWith("$argon2id$")).toBe(true)
    expect(await hasher.verify(hash, "480271")).toBe(true)
    expect(await hasher.verify(hash, "480272")).toBe(false)
    expect(await other.verify(hash, "480271")).toBe(false)
  })
})
