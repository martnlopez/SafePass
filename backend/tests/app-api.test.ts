import { randomUUID } from "node:crypto"
import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import { DataRuleError, UpstreamUnavailableError } from "../src/errors/app-error.js"
import type { AppDataRepository } from "../src/repositories/app-data.repository.js"
import type { AppDecision, AppEvaluation, AppPass, BatteryEntry } from "../src/types/app.js"
import { pino } from "pino"
import { createApp } from "../src/app.js"
import { buildContainer, createUnavailableRepositories } from "../src/container.js"
import { createTestApp, testConfig } from "./helpers/test-app.js"

/**
 * Pruebas de contrato de /api/v1/app. Supabase se reemplaza por un falso que reproduce
 * lo que hacen sus reglas (códigos en MAYÚSCULAS): aquí se prueba la traducción a HTTP,
 * la validación de forma y la autenticación, no las reglas (esas se prueban en SQL).
 */
const WORKER = randomUUID()
const SUPERVISOR = randomUUID()
const TOKENS: Record<string, string> = { "tok-worker": WORKER, "tok-sup": SUPERVISOR }

const BREAKDOWN: BatteryEntry[] = (["figuras", "gonogo", "memoria", "pvt", "tracking"] as const).map((key) => ({
  key,
  name: key,
  detail: "ok",
  score: 90,
}))

class FakeSupabase implements AppDataRepository {
  sessions = new Map<string, { worker: string; startedAt: number; evaluation?: AppEvaluation }>()
  failNext: Error | null = null
  now = Date.now()

  private maybeFail() {
    if (this.failNext) {
      const e = this.failNext
      this.failNext = null
      throw e
    }
  }
  private uid(token: string) {
    const id = TOKENS[token]
    if (!id) throw new DataRuleError("NOT_AUTHENTICATED")
    return id
  }

  async verifyAccessToken(token: string) {
    this.maybeFail()
    return TOKENS[token] ?? null
  }
  async profile(token: string, userId: string) {
    return {
      id: userId,
      fichaId: TOKENS[token] === SUPERVISOR ? "TRB-0513" : "TRB-0512",
      fullName: "Persona",
      position: "Operador",
      company: null,
      shift: "Día",
      role: TOKENS[token] === SUPERVISOR ? ("supervisor" as const) : ("worker" as const),
    }
  }
  async evaluations() {
    return []
  }
  async latestEvaluation() {
    return null
  }
  async latestDecision() {
    return null
  }
  async currentPass(_t: string, _u: string, fichaId: string): Promise<AppPass | null> {
    return { id: randomUUID(), code: "SP-ABC123", fichaId, issuedAt: new Date().toISOString(), expiresAt: new Date().toISOString() }
  }
  async startEvaluation(token: string) {
    this.maybeFail()
    const id = randomUUID()
    this.sessions.set(id, { worker: this.uid(token), startedAt: this.now })
    return id
  }
  async submitEvaluation(token: string, sessionId: string, breakdown: BatteryEntry[]) {
    const s = this.sessions.get(sessionId)
    if (!s || s.worker !== this.uid(token)) throw new DataRuleError("EVALUATION_SESSION_INVALID")
    if (s.evaluation) return { ...s.evaluation, replayed: true }
    if (this.now - s.startedAt < 60_000) throw new DataRuleError("EVALUATION_TOO_FAST")
    s.evaluation = {
      id: randomUUID(),
      workerId: s.worker,
      score: 90,
      status: "apto",
      completedAt: new Date().toISOString(),
      breakdown,
    }
    return { ...s.evaluation, replayed: false }
  }
  async issuePass(): Promise<AppPass> {
    throw new DataRuleError("PASS_NOT_ALLOWED")
  }
  async validatePass(token: string) {
    if (this.uid(token) !== SUPERVISOR) throw new DataRuleError("NOT_ALLOWED")
    return { status: "invalid" as const, reason: null, pass: null, holder: null }
  }
  async createDecision(token: string, input: { workerId: string; decision: AppDecision["decision"]; note: string | null }) {
    const uid = this.uid(token)
    if (uid !== SUPERVISOR) throw new DataRuleError("NOT_ALLOWED")
    if (input.workerId === uid) throw new DataRuleError("SELF_DECISION_NOT_ALLOWED")
    return {
      id: randomUUID(),
      workerId: input.workerId,
      decision: input.decision,
      note: input.note,
      decidedByFicha: "TRB-0513",
      decidedAt: new Date().toISOString(),
      evaluationScore: null,
      evaluationStatus: null,
      seenAt: null,
      consumedAt: null,
    }
  }
  async markDecisionSeen() {}
  async startAuthorizedRetest() {
    throw new DataRuleError("RETEST_REST_PENDING")
  }
}

describe("API de la app (/api/v1/app)", () => {
  let fake: FakeSupabase
  let t: ReturnType<typeof createTestApp>
  const as = (token: string) => ({ Authorization: `Bearer ${token}` })

  beforeEach(() => {
    fake = new FakeSupabase()
    t = createTestApp({}, { appData: fake })
  })

  it("sin token → 401; token inválido → 401", async () => {
    expect((await request(t.app).get("/api/v1/app/me")).status).toBe(401)
    const bad = await request(t.app).get("/api/v1/app/me").set(as("otro"))
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe("INVALID_SESSION")
  })

  it("GET /app/me devuelve el perfil propio", async () => {
    const res = await request(t.app).get("/api/v1/app/me").set(as("tok-worker"))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: WORKER, fichaId: "TRB-0512", role: "worker" })
  })

  it("sesión: 201 + Location; envío rápido → 422; envío válido → 201; reintento → 200 con la misma evaluación", async () => {
    const start = await request(t.app).post("/api/v1/app/evaluation-sessions").set(as("tok-worker"))
    expect(start.status).toBe(201)
    expect(start.headers.location).toBe(`/api/v1/app/evaluation-sessions/${start.body.id}`)
    const url = `/api/v1/app/evaluation-sessions/${start.body.id}/result`

    const fast = await request(t.app).post(url).set(as("tok-worker")).send({ breakdown: BREAKDOWN })
    expect(fast.status).toBe(422)
    expect(fast.body.error.code).toBe("EVALUATION_TOO_FAST")

    fake.now += 120_000
    const first = await request(t.app).post(url).set(as("tok-worker")).send({ breakdown: BREAKDOWN })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ status: "apto", replayed: false })

    const replay = await request(t.app).post(url).set(as("tok-worker")).send({ breakdown: BREAKDOWN })
    expect(replay.status).toBe(200)
    expect(replay.body).toMatchObject({ id: first.body.id, replayed: true })
  })

  it("la sesión de otro usuario → 404", async () => {
    const start = await request(t.app).post("/api/v1/app/evaluation-sessions").set(as("tok-worker"))
    fake.now += 120_000
    const res = await request(t.app)
      .post(`/api/v1/app/evaluation-sessions/${start.body.id}/result`)
      .set(as("tok-sup"))
      .send({ breakdown: BREAKDOWN })
    expect(res.status).toBe(404)
  })

  it("aduana de entrada: desglose incompleto, campos de más o id inválido → 400", async () => {
    const id = randomUUID()
    const short = await request(t.app)
      .post(`/api/v1/app/evaluation-sessions/${id}/result`)
      .set(as("tok-worker"))
      .send({ breakdown: BREAKDOWN.slice(0, 4) })
    expect(short.status).toBe(400)
    const extra = await request(t.app)
      .post(`/api/v1/app/evaluation-sessions/${id}/result`)
      .set(as("tok-worker"))
      .send({ breakdown: BREAKDOWN, score: 100 })
    expect(extra.status).toBe(400)
    const badId = await request(t.app).post("/api/v1/app/evaluation-sessions/123/result").set(as("tok-worker")).send({ breakdown: BREAKDOWN })
    expect(badId.status).toBe(400)
  })

  it("reglas de la base → códigos HTTP del contrato (403, 422, 429 + Retry-After)", async () => {
    const pass = await request(t.app).post("/api/v1/app/access-passes").set(as("tok-worker"))
    expect(pass.status).toBe(422)
    expect(pass.body.error.code).toBe("PASS_NOT_ALLOWED")

    const notSup = await request(t.app).post("/api/v1/app/pass-validations").set(as("tok-worker")).send({ code: "SP-ABC123" })
    expect(notSup.status).toBe(403)

    const retest = await request(t.app).post(`/api/v1/app/decisions/${randomUUID()}/retest-starts`).set(as("tok-worker"))
    expect(retest.status).toBe(429)
    expect(retest.headers["retry-after"]).toBe("60")
  })

  it("decisiones: el supervisor decide sobre otro (201) pero no sobre sí mismo (403)", async () => {
    const ok = await request(t.app)
      .post("/api/v1/app/decisions")
      .set(as("tok-sup"))
      .send({ workerId: WORKER, decision: "retest", note: "Descansa 15 min" })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ workerId: WORKER, decision: "retest" })

    const self = await request(t.app).post("/api/v1/app/decisions").set(as("tok-sup")).send({ workerId: SUPERVISOR, decision: "pase" })
    expect(self.status).toBe(403)
    expect(self.body.error.code).toBe("SELF_DECISION_NOT_ALLOWED")

    const bad = await request(t.app).post("/api/v1/app/decisions").set(as("tok-sup")).send({ workerId: WORKER, decision: "aprobar" })
    expect(bad.status).toBe(400)
  })

  it("marcar decisión vista → 204; cualquier otro cambio → 400", async () => {
    const id = randomUUID()
    expect((await request(t.app).patch(`/api/v1/app/decisions/${id}`).set(as("tok-worker")).send({ seen: true })).status).toBe(204)
    expect((await request(t.app).patch(`/api/v1/app/decisions/${id}`).set(as("tok-worker")).send({ consumed: true })).status).toBe(400)
  })

  it("Supabase sin respuesta → 503 + Retry-After (el cliente reintenta)", async () => {
    fake.failNext = new UpstreamUnavailableError()
    const res = await request(t.app).get("/api/v1/app/me").set(as("tok-worker"))
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe("UPSTREAM_UNAVAILABLE")
    expect(res.headers["retry-after"]).toBe("5")
  })

  it("sin configuración de Supabase la API de la app responde 503", async () => {
    const off = createTestApp()
    const res = await request(off.app).get("/api/v1/app/me").set(as("tok-worker"))
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe("APP_API_DISABLED")
  })
})

describe("servidor sin base propia (solo API de la app)", () => {
  const app = createApp(
    buildContainer({
      config: testConfig(),
      logger: pino({ level: "silent" }),
      repositories: createUnavailableRepositories(),
      appData: new FakeSupabase(),
    }),
  )

  it("la API de la app funciona", async () => {
    const res = await request(app).get("/api/v1/app/me").set({ Authorization: "Bearer tok-worker" })
    expect(res.status).toBe(200)
  })

  it("las rutas del tótem y del panel responden 503 sin filtrar detalles", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ fichaId: "TRB-0512", pin: "480271" })
    expect(login.status).toBe(503)
    expect(login.body.error.code).toBe("DATABASE_NOT_CONFIGURED")
  })

  it("/health/ready informa la base como deshabilitada, no caída", async () => {
    const res = await request(app).get("/health/ready")
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "ok", database: "disabled" })
  })
})
