import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, METRICS, randomRut } from "./helpers/test-app.js"

type TestApp = ReturnType<typeof createTestApp>

describe("API SafePass", () => {
  let t: TestApp
  let admin: Awaited<ReturnType<TestApp["seedWorker"]>>
  let supervisor: Awaited<ReturnType<TestApp["seedWorker"]>>
  let operator: Awaited<ReturnType<TestApp["seedWorker"]>>
  let totem: Awaited<ReturnType<TestApp["seedTotem"]>>

  beforeEach(async () => {
    t = createTestApp()
    admin = await t.seedWorker("ADM-0001", "ADMIN")
    supervisor = await t.seedWorker("SUP-0001", "SUPERVISOR")
    operator = await t.seedWorker("TRB-0512", "OPERATOR")
    totem = await t.seedTotem()
  })

  const advanceMinutes = (m: number) => (t.clock.now = new Date(t.clock.now.getTime() + m * 60_000))

  async function submit(metrics: object, worker = operator) {
    const session = await t.totemSession(totem.key, worker.fichaId, worker.pin)
    expect(session.status).toBe(201)
    return request(t.app).post("/api/v1/evaluations").set("Authorization", `Bearer ${session.body.sessionToken}`).send(metrics)
  }

  describe("autenticación", () => {
    it("login de staff devuelve JWT y /auth/me", async () => {
      const token = await t.staffToken(supervisor.fichaId, supervisor.pin)
      const me = await request(t.app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`)
      expect(me.status).toBe(200)
      expect(me.body).toMatchObject({ fichaId: "SUP-0001", role: "SUPERVISOR" })
    })

    it("mismo 401 para ficha inexistente y PIN incorrecto", async () => {
      const a = await request(t.app).post("/api/v1/auth/login").send({ fichaId: "XXX-0000", pin: "480271" })
      const b = await request(t.app).post("/api/v1/auth/login").send({ fichaId: admin.fichaId, pin: "480271" })
      expect([a.status, b.status]).toEqual([401, 401])
      expect(a.body.error.message).toBe(b.body.error.message)
    })

    it("operadores no entran al panel", async () => {
      const res = await request(t.app).post("/api/v1/auth/login").send({ fichaId: operator.fichaId, pin: operator.pin })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe("STAFF_ONLY")
    })

    it("bloquea la cuenta tras 5 PIN erróneos y la libera al vencer el plazo", async () => {
      const codes: number[] = []
      for (let i = 0; i < 5; i++) {
        codes.push((await request(t.app).post("/api/v1/auth/login").send({ fichaId: supervisor.fichaId, pin: "000019" })).status)
      }
      expect(codes).toEqual([401, 401, 401, 401, 429])
      const locked = await request(t.app).post("/api/v1/auth/login").send({ fichaId: supervisor.fichaId, pin: supervisor.pin })
      expect(locked.status).toBe(429)
      expect(locked.body.error.code).toBe("ACCOUNT_LOCKED")
      expect(Number(locked.headers["retry-after"])).toBe(900)

      advanceMinutes(16)
      const ok = await request(t.app).post("/api/v1/auth/login").send({ fichaId: supervisor.fichaId, pin: supervisor.pin })
      expect(ok.status).toBe(200)
    })

    it("una cuenta desactivada pierde el acceso aunque tenga un token vigente", async () => {
      const token = await t.staffToken(supervisor.fichaId, supervisor.pin)
      await t.repos.workers.update(supervisor.id, { active: false })
      const res = await request(t.app).get("/api/v1/workers").set("Authorization", `Bearer ${token}`)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe("INVALID_SESSION")
    })

    it("rechaza tokens firmados con otro secreto", async () => {
      const other = createTestApp()
      const w = await other.seedWorker("ADM-0009", "ADMIN")
      const foreign = await other.staffToken(w.fichaId, w.pin)
      const res = await request(t.app).get("/api/v1/workers").set("Authorization", `Bearer ${foreign}`)
      expect(res.status).toBe(401)
    })
  })

  describe("RBAC", () => {
    it("aplica la matriz de roles", async () => {
      const sup = await t.staffToken(supervisor.fichaId, supervisor.pin)
      const session = await t.totemSession(totem.key, operator.fichaId, operator.pin)
      const totemToken = session.body.sessionToken as string

      expect((await request(t.app).get("/api/v1/workers")).status).toBe(401)
      expect((await request(t.app).post("/api/v1/workers").set("Authorization", `Bearer ${sup}`).send({})).status).toBe(403)
      expect((await request(t.app).get("/api/v1/evaluations").set("Authorization", `Bearer ${totemToken}`)).status).toBe(403)
      expect(
        (await request(t.app).post("/api/v1/evaluations").set("Authorization", `Bearer ${sup}`).send(METRICS.verde)).status,
      ).toBe(403)
    })

    it("sin clave de tótem no se abre sesión", async () => {
      const res = await request(t.app).post("/api/v1/auth/totem/session").send({ fichaId: operator.fichaId, pin: operator.pin })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe("INVALID_TOTEM_KEY")
    })
  })

  describe("workers", () => {
    it("crea, lista por cuadrilla, actualiza y desactiva", async () => {
      const token = await t.staffToken(admin.fichaId, admin.pin)
      const auth = { Authorization: `Bearer ${token}` }
      const rut = randomRut()

      const created = await request(t.app)
        .post("/api/v1/workers")
        .set(auth)
        .send({ fichaId: "trb-0777", rut, fullName: "Ana Pérez", position: "Operadora CAEX", crew: "4x3", pin: "480271" })
      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ fichaId: "TRB-0777", crew: "4x3", role: "OPERATOR", active: true })
      expect(created.body).not.toHaveProperty("pinHash")

      const list = await request(t.app).get("/api/v1/workers?crew=4x3").set(auth)
      expect(list.body.data.map((w: { fichaId: string }) => w.fichaId)).toEqual(["TRB-0777"])
      expect(list.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 })

      const updated = await request(t.app).put(`/api/v1/workers/${created.body.id}`).set(auth).send({ crew: "7x7" })
      expect(updated.body.crew).toBe("7x7")

      const removed = await request(t.app).delete(`/api/v1/workers/${created.body.id}`).set(auth)
      expect(removed.status).toBe(200)
      expect(removed.body.active).toBe(false)
      const afterList = await request(t.app).get("/api/v1/workers?crew=7x7").set(auth)
      expect(afterList.body.data.some((w: { id: string }) => w.id === created.body.id)).toBe(false)
    })

    it("RUT completo para ADMIN, enmascarado para SUPERVISOR", async () => {
      const adminList = await request(t.app).get("/api/v1/workers").set("Authorization", `Bearer ${await t.staffToken(admin.fichaId, admin.pin)}`)
      const supList = await request(t.app).get("/api/v1/workers").set("Authorization", `Bearer ${await t.staffToken(supervisor.fichaId, supervisor.pin)}`)
      expect(adminList.body.data[0].rut).toMatch(/^\d{2}\.\d{3}\.\d{3}-[\dK]$/)
      expect(supList.body.data[0].rut).toMatch(/^\*\*\.\*\*\*\.\d{3}-[\dK]$/)
    })

    it("valida DTO: campos extra, PIN trivial, RUT inválido, paginación máxima", async () => {
      const auth = { Authorization: `Bearer ${await t.staffToken(admin.fichaId, admin.pin)}` }
      const bad = await request(t.app)
        .post("/api/v1/workers")
        .set(auth)
        .send({ fichaId: "TRB-0778", rut: "12.345.678-9", fullName: "Ana", position: "Op", crew: "7x7", pin: "123456", role: "ADMIN", pinHash: "x" })
      expect(bad.status).toBe(400)
      const paths = bad.body.error.details.map((d: { path: string }) => d.path)
      expect(paths).toEqual(expect.arrayContaining(["rut", "pin"]))
      expect((await request(t.app).get("/api/v1/workers?pageSize=101").set(auth)).status).toBe(400)
    })

    it("409 por Ficha ID duplicada", async () => {
      const auth = { Authorization: `Bearer ${await t.staffToken(admin.fichaId, admin.pin)}` }
      const res = await request(t.app)
        .post("/api/v1/workers")
        .set(auth)
        .send({ fichaId: operator.fichaId, rut: randomRut(), fullName: "Otra Persona", position: "Op", crew: "7x7", pin: "480271" })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe("FICHA_TAKEN")
    })
  })

  describe("evaluaciones y reglas de re-evaluación", () => {
    it("el servidor calcula el dictamen y la respuesta al tótem no identifica al trabajador", async () => {
      const res = await submit(METRICS.verde)
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ score: 92, status: "VERDE", nextStep: { action: "INGRESO_AUTORIZADO" } })
      expect(JSON.stringify(res.body)).not.toMatch(/TRB-0512|worker|subject/)
      const stored = [...t.repos.evaluations.rows.values()][0]!
      expect(stored.subjectId).toBe(operator.pseudonymId)
      expect(stored.subjectId).not.toBe(operator.id)
    })

    it("rechaza que el cliente envíe score o status", async () => {
      const res = await submit({ ...METRICS.rojo, score: 100, status: "VERDE" })
      expect(res.status).toBe(400)
    })

    it("ROJO: sin temporizador, bloquea hasta que el supervisor autoriza", async () => {
      const rojo = await submit(METRICS.rojo)
      expect(rojo.body.status).toBe("ROJO")

      const blocked = await t.totemSession(totem.key, operator.fichaId, operator.pin)
      expect(blocked.status).toBe(403)
      expect(blocked.body.error.code).toBe("SUPERVISOR_AUTHORIZATION_REQUIRED")
      advanceMinutes(60)
      expect((await t.totemSession(totem.key, operator.fichaId, operator.pin)).status).toBe(403)

      const sup = await t.staffToken(supervisor.fichaId, supervisor.pin)
      const review = await request(t.app)
        .put(`/api/v1/evaluations/${rojo.body.id}`)
        .set("Authorization", `Bearer ${sup}`)
        .send({ decision: "AUTORIZAR_REEVALUACION", note: "Descanso e hidratación; se autoriza segundo intento" })
      expect(review.status).toBe(200)
      expect(review.body.review).toMatchObject({ decision: "AUTORIZAR_REEVALUACION", note: expect.stringContaining("Descanso") })
      expect(review.body.worker).toMatchObject({ fichaId: "TRB-0512" })

      expect((await t.totemSession(totem.key, operator.fichaId, operator.pin)).status).toBe(201)
    })

    it("AMARILLO: descanso preventivo de 5 minutos (429 + Retry-After)", async () => {
      const semi = await submit(METRICS.amarillo)
      expect(semi.body.status).toBe("AMARILLO")
      expect(semi.body.nextStep.action).toBe("DESCANSO_Y_REEVALUACION")

      const early = await t.totemSession(totem.key, operator.fichaId, operator.pin)
      expect(early.status).toBe(429)
      expect(early.body.error.code).toBe("RETEST_COOLDOWN")
      expect(Number(early.headers["retry-after"])).toBe(300)

      advanceMinutes(5)
      expect((await t.totemSession(totem.key, operator.fichaId, operator.pin)).status).toBe(201)
    })

    it("una sesión de tótem registra una sola evaluación", async () => {
      const session = await t.totemSession(totem.key, operator.fichaId, operator.pin)
      const auth = { Authorization: `Bearer ${session.body.sessionToken}` }
      expect((await request(t.app).post("/api/v1/evaluations").set(auth).send(METRICS.verde)).status).toBe(201)
      const replay = await request(t.app).post("/api/v1/evaluations").set(auth).send(METRICS.verde)
      expect(replay.status).toBe(409)
      expect(replay.body.error.code).toBe("SESSION_ALREADY_USED")
    })

    it("cambiar el dictamen exige observación y conserva el dictamen del algoritmo", async () => {
      const rojo = await submit(METRICS.rojo)
      const sup = { Authorization: `Bearer ${await t.staffToken(supervisor.fichaId, supervisor.pin)}` }
      const noNote = await request(t.app).put(`/api/v1/evaluations/${rojo.body.id}`).set(sup).send({ status: "AMARILLO" })
      expect(noNote.status).toBe(400)
      const ok = await request(t.app)
        .put(`/api/v1/evaluations/${rojo.body.id}`)
        .set(sup)
        .send({ status: "AMARILLO", note: "Falla de pantalla durante la prueba" })
      expect(ok.body).toMatchObject({ computedStatus: "ROJO", status: "AMARILLO" })
    })

    it("anulación justificada: solo ADMIN, con motivo, y deja de contar para las reglas", async () => {
      const rojo = await submit(METRICS.rojo)
      const sup = { Authorization: `Bearer ${await t.staffToken(supervisor.fichaId, supervisor.pin)}` }
      const adm = { Authorization: `Bearer ${await t.staffToken(admin.fichaId, admin.pin)}` }

      expect((await request(t.app).delete(`/api/v1/evaluations/${rojo.body.id}`).set(sup).send({ reason: "Falla del sensor del tótem" })).status).toBe(403)
      expect((await request(t.app).delete(`/api/v1/evaluations/${rojo.body.id}`).set(adm).send({})).status).toBe(400)
      const voided = await request(t.app).delete(`/api/v1/evaluations/${rojo.body.id}`).set(adm).send({ reason: "Falla del sensor del tótem" })
      expect(voided.status).toBe(200)
      expect(voided.body.voided.reason).toBe("Falla del sensor del tótem")

      expect((await t.totemSession(totem.key, operator.fichaId, operator.pin)).status).toBe(201)
      const list = await request(t.app).get("/api/v1/evaluations").set(sup)
      expect(list.body.meta.total).toBe(0)
      const withVoided = await request(t.app).get("/api/v1/evaluations?includeVoided=true").set(sup)
      expect(withVoided.body.meta.total).toBe(1)
    })

    it("lista con filtros y paginación, sin exponer observaciones", async () => {
      await submit(METRICS.verde)
      const other = await t.seedWorker("TRB-0431", "OPERATOR", "4x3")
      await submit(METRICS.rojo, other)
      const sup = { Authorization: `Bearer ${await t.staffToken(supervisor.fichaId, supervisor.pin)}` }

      const rojos = await request(t.app).get("/api/v1/evaluations?status=ROJO").set(sup)
      expect(rojos.body.data).toHaveLength(1)
      expect(rojos.body.data[0].worker.fichaId).toBe("TRB-0431")

      const byWorker = await request(t.app).get(`/api/v1/evaluations?workerId=${operator.id}&pageSize=1`).set(sup)
      expect(byWorker.body.meta).toMatchObject({ total: 1, pageSize: 1 })
      expect(byWorker.body.data[0].worker.fichaId).toBe("TRB-0512")
    })

    it("la bitácora registra acciones sin PIN ni RUT", async () => {
      await submit(METRICS.verde)
      const actions = t.repos.audit.entries.map((e) => e.action)
      expect(actions).toEqual(expect.arrayContaining(["TOTEM_SESSION_STARTED", "EVALUATION_SUBMITTED"]))
      expect(JSON.stringify(t.repos.audit.entries)).not.toContain(operator.pin)
    })
  })

  describe("rate limiting", () => {
    it("limita los intentos fallidos de login por IP", async () => {
      const limited = createTestApp({ RATE_LIMIT_LOGIN_MAX: "3" })
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) {
        statuses.push((await request(limited.app).post("/api/v1/auth/login").send({ fichaId: "XXX-0001", pin: "480271" })).status)
      }
      expect(statuses).toEqual([401, 401, 401, 429])
    })
  })
})
