import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { pino } from "pino"
import request from "supertest"
import { createApp } from "../../src/app.js"
import { loadConfig } from "../../src/config/env.js"
import { buildContainer } from "../../src/container.js"
import type { AppDataRepository } from "../../src/repositories/app-data.repository.js"
import { FieldCipher, generateDeviceSecret, sha256Hex } from "../../src/lib/crypto.js"
import { isWeakPin, PinHasher } from "../../src/lib/pin.js"
import { computeCheckDigit, normalizeRut } from "../../src/lib/rut.js"
import { RUT_CONTEXT } from "../../src/services/worker.service.js"
import type { Crew, Role } from "../../src/types/domain.js"
import { healthyDb, InMemoryAudit, InMemoryEvaluations, InMemoryTotems, InMemoryWorkers } from "./fakes.js"

/** Secretos aleatorios por ejecución: los tests no dependen de claves fijas */
export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://unused@localhost:5432/unused",
    CORS_ORIGINS: "http://localhost:5173",
    JWT_SECRET: randomBytes(48).toString("base64url"),
    PIN_PEPPER: randomBytes(48).toString("base64url"),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
    RATE_LIMIT_MAX: "10000",
    RATE_LIMIT_LOGIN_MAX: "10000",
    RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX: "10000",
    RATE_LIMIT_EVALUATIONS_PER_MINUTE: "10000",
    ...overrides,
  })
}

export function randomPin(): string {
  let pin: string
  do pin = String(randomInt(0, 1_000_000)).padStart(6, "0")
  while (isWeakPin(pin))
  return pin
}

let rutSeq = 21_000_000
export function randomRut(): string {
  const body = String(rutSeq++)
  return `${body}-${computeCheckDigit(body)}`
}

export function createTestApp(overrides: Record<string, string> = {}, options: { appData?: AppDataRepository } = {}) {
  const config = testConfig(overrides)
  const clock = { now: new Date("2026-09-28T08:00:00Z") }
  const now = () => new Date(clock.now)

  const workers = new InMemoryWorkers()
  const totems = new InMemoryTotems()
  const evaluations = new InMemoryEvaluations(totems, now)
  const audit = new InMemoryAudit()

  const container = buildContainer({
    config,
    logger: pino({ level: "silent" }),
    repositories: { workers, totems, evaluations, auditLogs: audit, health: healthyDb },
    appData: options.appData ?? null,
    now,
  })
  const app = createApp(container)

  const cipher = new FieldCipher(config.FIELD_ENCRYPTION_KEY, config.BLIND_INDEX_KEY)
  const pins = new PinHasher(config.PIN_PEPPER)

  async function seedWorker(fichaId: string, role: Role, crew: Crew = "7x7") {
    const pin = randomPin()
    const rut = normalizeRut(randomRut())
    const worker = await workers.create({
      pseudonymId: randomUUID(),
      fichaId,
      rutEncrypted: cipher.encrypt(rut, RUT_CONTEXT),
      rutHash: cipher.blindIndex(rut, RUT_CONTEXT),
      fullName: `Persona ${fichaId}`,
      position: "Operador CAEX",
      company: null,
      crew,
      role,
      pinHash: await pins.hash(pin),
    })
    return { ...worker, pin }
  }

  async function seedTotem(name = "Garita Test") {
    const secret = generateDeviceSecret()
    const totem = await totems.create({ name, location: null, keyHash: sha256Hex(secret) })
    return { ...totem, key: `${totem.id}.${secret}` }
  }

  async function staffToken(fichaId: string, pin: string): Promise<string> {
    const res = await request(app).post("/api/v1/auth/login").send({ fichaId, pin })
    if (res.status !== 200) throw new Error(`login ${fichaId} → ${res.status} ${JSON.stringify(res.body)}`)
    return res.body.accessToken as string
  }

  function totemSession(totemKey: string, fichaId: string, pin: string) {
    return request(app).post("/api/v1/auth/totem/session").set("X-Totem-Key", totemKey).send({ fichaId, pin })
  }

  return { app, config, clock, repos: { workers, totems, evaluations, audit }, seedWorker, seedTotem, staffToken, totemSession }
}

/** Métricas PVT-B de ejemplo para cada tramo */
export const METRICS = {
  verde: { meanLatencyMs: 290, medianReactionTimeMs: 280, omissions: 1, falseStarts: 0, totalStimuli: 35, durationSeconds: 180 },
  amarillo: { meanLatencyMs: 380, medianReactionTimeMs: 360, omissions: 5, falseStarts: 0, totalStimuli: 35, durationSeconds: 180 },
  rojo: { meanLatencyMs: 450, medianReactionTimeMs: 430, omissions: 8, falseStarts: 2, totalStimuli: 35, durationSeconds: 180 },
}
