import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { DataRuleError, UpstreamUnavailableError } from "../errors/app-error.js"
import type {
  AppDecision,
  AppDecisionType,
  AppEvaluation,
  AppPass,
  AppProfile,
  BatteryEntry,
  PassValidation,
} from "../types/app.js"

/**
 * Datos de la app SafePass en Supabase. Cada operación usa el token del PROPIO usuario,
 * así que Supabase aplica RLS y las reglas de las RPC como si la app llamara directo:
 * el backend no se salta ningún control ni duplica reglas (fuente única de verdad).
 *
 * Índice (mini-contrato interno):
 *  ping · verifyAccessToken · profile · evaluations · latestEvaluation · latestDecision · currentPass
 *  startEvaluation · submitEvaluation · issuePass · validatePass
 *  createDecision · markDecisionSeen · startAuthorizedRetest
 */
export interface AppDataRepository {
  /** Comprueba que el servicio de autenticación de Supabase responde (lanza si no) */
  ping(): Promise<void>
  /** Verifica el token de Supabase Auth; devuelve el id del usuario o null si no es válido */
  verifyAccessToken(token: string): Promise<string | null>
  profile(token: string, userId: string): Promise<AppProfile | null>
  evaluations(token: string, userId: string): Promise<AppEvaluation[]>
  latestEvaluation(token: string, userId: string): Promise<AppEvaluation | null>
  latestDecision(token: string, userId: string): Promise<AppDecision | null>
  currentPass(token: string, userId: string, fichaId: string): Promise<AppPass | null>
  startEvaluation(token: string): Promise<string>
  /** durationSeconds null = app sin actualizar (la base usa el tiempo hasta la llegada) */
  submitEvaluation(
    token: string,
    sessionId: string,
    breakdown: BatteryEntry[],
    durationSeconds: number | null,
  ): Promise<AppEvaluation & { replayed: boolean }>
  issuePass(token: string): Promise<AppPass>
  validatePass(token: string, code: string): Promise<PassValidation>
  createDecision(token: string, input: { workerId: string; decision: AppDecisionType; note: string | null }): Promise<AppDecision>
  markDecisionSeen(token: string, decisionId: string): Promise<void>
  startAuthorizedRetest(token: string, decisionId: string): Promise<void>
}

const EVALUATION_COLUMNS = "id, worker_id, score, status, completed_at, received_at, breakdown"
const DECISION_COLUMNS =
  "id, worker_id, decision, note, decided_by_ficha, decided_at, evaluation_score, evaluation_status, seen_at, consumed_at"

type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))

function toEvaluation(r: Row): AppEvaluation {
  return {
    id: String(r["id"]),
    workerId: String(r["worker_id"]),
    score: Number(r["score"]),
    status: r["status"] as AppEvaluation["status"],
    completedAt: new Date(String(r["completed_at"])).toISOString(),
    // Hora de llegada (desde 2026-11-23); los descansos se cuentan desde aquí (D10)
    receivedAt: r["received_at"] ? new Date(String(r["received_at"])).toISOString() : null,
    breakdown: (r["breakdown"] as BatteryEntry[] | null) ?? null,
  }
}

function toDecision(r: Row): AppDecision {
  return {
    id: String(r["id"]),
    workerId: String(r["worker_id"]),
    decision: r["decision"] as AppDecisionType,
    note: str(r["note"]),
    decidedByFicha: str(r["decided_by_ficha"]),
    decidedAt: new Date(String(r["decided_at"])).toISOString(),
    evaluationScore: r["evaluation_score"] === null ? null : Number(r["evaluation_score"]),
    evaluationStatus: (r["evaluation_status"] as AppDecision["evaluationStatus"]) ?? null,
    seenAt: str(r["seen_at"]),
    consumedAt: str(r["consumed_at"]),
  }
}

function toPass(r: Row, fichaId: string): AppPass {
  return {
    id: String(r["id"]),
    code: String(r["code"]),
    fichaId,
    issuedAt: new Date(String(r["issued_at"])).toISOString(),
    expiresAt: new Date(String(r["expires_at"])).toISOString(),
  }
}

/**
 * Traduce un error de Supabase a un error del nivel de datos:
 *  - código en MAYÚSCULAS lanzado por una regla de la base → DataRuleError
 *  - permiso denegado por RLS (42501) → DataRuleError("NOT_ALLOWED")
 *  - red / timeout → UpstreamUnavailableError
 *  - cualquier otro → Error genérico (500 sobrio; el detalle queda en el log)
 */
function translate(error: { message?: string; code?: string } | Error): Error {
  const message = error.message ?? ""
  const code = "code" in error ? error.code : undefined
  if (/^[A-Z][A-Z_]+$/.test(message)) return new DataRuleError(message)
  if (code === "42501") return new DataRuleError("NOT_ALLOWED")
  if (/fetch failed|network|abort|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return new UpstreamUnavailableError(error)
  }
  return new Error(`Supabase: ${code ?? ""} ${message}`.trim())
}

async function run<T>(op: PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>): Promise<T> {
  let result: { data: T; error: { message?: string; code?: string } | null }
  try {
    result = await op
  } catch (err) {
    throw translate(err as Error)
  }
  if (result.error) throw translate(result.error)
  return result.data
}

export class SupabaseAppDataRepository implements AppDataRepository {
  private readonly verifier: SupabaseClient

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
    private readonly timeoutMs: number,
  ) {
    this.verifier = this.client()
  }

  /** Timeout explícito en toda llamada remota (prompt §7.6) */
  private readonly fetchWithTimeout = (input: string | URL | Request, init?: RequestInit) => {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
  }

  private client(token?: string): SupabaseClient {
    return createClient(this.url, this.publishableKey, {
      global: { fetch: this.fetchWithTimeout, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }

  async ping(): Promise<void> {
    let res: Response
    try {
      res = await this.fetchWithTimeout(`${this.url}/auth/v1/health`, { headers: { apikey: this.publishableKey } })
    } catch (err) {
      throw translate(err as Error)
    }
    if (!res.ok) throw new UpstreamUnavailableError(`HTTP ${res.status}`)
  }

  async verifyAccessToken(token: string): Promise<string | null> {
    try {
      const { data, error } = await this.verifier.auth.getClaims(token)
      if (error) {
        const translated = translate(error)
        if (translated instanceof UpstreamUnavailableError) throw translated
        return null
      }
      const sub = data?.claims?.sub
      return typeof sub === "string" && sub ? sub : null
    } catch (err) {
      if (err instanceof UpstreamUnavailableError) throw err
      const translated = translate(err as Error)
      if (translated instanceof UpstreamUnavailableError) throw translated
      return null
    }
  }

  async profile(token: string, userId: string): Promise<AppProfile | null> {
    const row = await run(
      this.client(token)
        .from("workers")
        .select("id, ficha_id, full_name, position, company, shift, app_role, active")
        .eq("id", userId)
        .maybeSingle<Row>(),
    )
    if (!row || row["active"] !== true) return null
    return {
      id: String(row["id"]),
      fichaId: String(row["ficha_id"]),
      fullName: String(row["full_name"]),
      position: String(row["position"]),
      company: str(row["company"]),
      shift: String(row["shift"]),
      role: row["app_role"] === "supervisor" ? "supervisor" : "worker",
    }
  }

  async evaluations(token: string, userId: string): Promise<AppEvaluation[]> {
    const rows = await run(
      this.client(token)
        .from("evaluations")
        .select(EVALUATION_COLUMNS)
        .eq("worker_id", userId)
        .order("completed_at", { ascending: true })
        .limit(200)
        .returns<Row[]>(),
    )
    return (rows ?? []).map(toEvaluation)
  }

  async latestEvaluation(token: string, userId: string): Promise<AppEvaluation | null> {
    const row = await run(
      this.client(token).from("latest_evaluations").select(EVALUATION_COLUMNS).eq("worker_id", userId).maybeSingle<Row>(),
    )
    return row ? toEvaluation(row) : null
  }

  async latestDecision(token: string, userId: string): Promise<AppDecision | null> {
    const row = await run(
      this.client(token).from("latest_decisions").select(DECISION_COLUMNS).eq("worker_id", userId).maybeSingle<Row>(),
    )
    return row ? toDecision(row) : null
  }

  async currentPass(token: string, userId: string, fichaId: string): Promise<AppPass | null> {
    const row = await run(
      this.client(token)
        .from("access_passes")
        .select("id, code, issued_at, expires_at")
        .eq("worker_id", userId)
        .gt("expires_at", new Date().toISOString())
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle<Row>(),
    )
    return row ? toPass(row, fichaId) : null
  }

  async startEvaluation(token: string): Promise<string> {
    return String(await run(this.client(token).rpc("start_evaluation")))
  }

  async submitEvaluation(token: string, sessionId: string, breakdown: BatteryEntry[], durationSeconds: number | null) {
    const row = await run(
      this.client(token).rpc("submit_evaluation", {
        p_session_id: sessionId,
        p_breakdown: breakdown,
        p_duration_seconds: durationSeconds,
      }),
    ) as Row
    return { ...toEvaluation(row), replayed: row["replayed"] === true }
  }

  async issuePass(token: string): Promise<AppPass> {
    const row = (await run(this.client(token).rpc("issue_access_pass"))) as Row
    return toPass(row, String(row["ficha_id"]))
  }

  async validatePass(token: string, code: string): Promise<PassValidation> {
    const row = (await run(this.client(token).rpc("validate_pass", { p_code: code }))) as Row
    const status = row["status"] as PassValidation["status"]
    if (status === "invalid") return { status, reason: null, pass: null, holder: null }
    return {
      status,
      reason: (row["reason"] as PassValidation["reason"]) ?? null,
      pass: toPass(row, String(row["ficha_id"])),
      holder: { fullName: String(row["full_name"]), position: String(row["position"]), company: str(row["company"]) },
    }
  }

  async createDecision(token: string, input: { workerId: string; decision: AppDecisionType; note: string | null }) {
    const row = await run(
      this.client(token)
        .from("decisions")
        .insert({ worker_id: input.workerId, decision: input.decision, note: input.note })
        .select(DECISION_COLUMNS)
        .single<Row>(),
    )
    if (!row) throw new Error("Supabase no devolvió la decisión creada")
    return toDecision(row)
  }

  async markDecisionSeen(token: string, decisionId: string): Promise<void> {
    await run(this.client(token).rpc("mark_decision_seen", { p_decision_id: decisionId }))
  }

  async startAuthorizedRetest(token: string, decisionId: string): Promise<void> {
    await run(this.client(token).rpc("start_authorized_retest", { p_decision_id: decisionId }))
  }
}
