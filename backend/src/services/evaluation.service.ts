import { Errors, UniqueConstraintError } from "../errors/app-error.js"
import type { FieldCipher } from "../lib/crypto.js"
import type { EvaluationChanges, EvaluationRepository } from "../repositories/evaluation.repository.js"
import type { WorkerRepository } from "../repositories/worker.repository.js"
import type {
  CreateEvaluationDto,
  ListEvaluationsDto,
  ReviewEvaluationDto,
  VoidEvaluationDto,
} from "../schemas/evaluation.schema.js"
import type { StaffPrincipal, TotemSessionPrincipal } from "../types/auth.js"
import {
  paginate,
  type EvaluationRecord,
  type RequestContext,
  type SupervisorDecision,
  type WorkerRecord,
} from "../types/domain.js"
import type { AuditService } from "./audit.service.js"
import type { EvaluationEligibility } from "./auth.service.js"
import { computePvtScore } from "./scoring.service.js"

export const NOTE_CONTEXT = "evaluation.supervisor_note"

/** Decisiones del supervisor que impiden volver a rendir hasta que autorice una re-evaluación */
const BLOCKING_DECISIONS: ReadonlySet<SupervisorDecision> = new Set(["SUSPENSION_TURNO", "DERIVACION_POLICLINICO"])

export interface EvaluationSettings {
  retestCooldownMinutes: number
}

export class EvaluationService implements EvaluationEligibility {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly workers: WorkerRepository,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
    private readonly settings: EvaluationSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Reglas de re-evaluación (se verifican al abrir la sesión en el tótem y otra vez al enviar):
   *  - ROJO (NO APTO): sin temporizador; solo puede volver a rendir si el supervisor
   *    registró la decisión AUTORIZAR_REEVALUACION.
   *  - AMARILLO (SEMI-APTO): descanso preventivo de RETEST_COOLDOWN_MINUTES (429 + Retry-After).
   *  - Suspensión de turno o derivación a policlínico: bloquea hasta nueva autorización.
   */
  async assertCanStartEvaluation(subjectId: string): Promise<void> {
    const last = await this.evaluations.findLatestActiveBySubject(subjectId)
    if (!last || last.supervisorDecision === "AUTORIZAR_REEVALUACION") return

    if (last.status === "ROJO" || (last.supervisorDecision && BLOCKING_DECISIONS.has(last.supervisorDecision))) {
      throw Errors.forbidden(
        "Tu última evaluación requiere revisión. Un nuevo intento debe autorizarlo tu supervisor.",
        "SUPERVISOR_AUTHORIZATION_REQUIRED",
      )
    }
    if (last.status === "AMARILLO") {
      const availableAt = this.retestAvailableAt(last)
      const waitMs = availableAt.getTime() - this.now().getTime()
      if (waitMs > 0) {
        throw Errors.tooManyRequests(
          "Debes completar el descanso preventivo antes de volver a rendir la prueba",
          Math.ceil(waitMs / 1000),
          "RETEST_COOLDOWN",
        )
      }
    }
  }

  /** Registro desde el tótem: el servidor calcula puntaje y dictamen; el cliente solo envía métricas crudas */
  async submit(session: TotemSessionPrincipal, dto: CreateEvaluationDto, ctx: RequestContext) {
    await this.assertCanStartEvaluation(session.subjectId)
    const result = computePvtScore(dto)

    let evaluation: EvaluationRecord
    try {
      evaluation = await this.evaluations.create({
        ...dto,
        subjectId: session.subjectId,
        totemId: session.totemId,
        sessionId: session.sessionId,
        score: result.score,
        computedStatus: result.status,
        status: result.status,
        scoringVersion: result.version,
      })
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw Errors.conflict("Esta sesión ya registró una evaluación. Inicia una nueva sesión.", "SESSION_ALREADY_USED")
      }
      throw err
    }

    await this.audit.record(
      {
        actorType: "TOTEM",
        actorId: session.totemId,
        action: "EVALUATION_SUBMITTED",
        entityType: "Evaluation",
        entityId: evaluation.id,
        metadata: { scoringVersion: result.version },
      },
      ctx,
    )

    // Respuesta para el tótem: sin datos de identidad
    return {
      id: evaluation.id,
      score: evaluation.score,
      status: evaluation.status,
      scoringVersion: evaluation.scoringVersion,
      createdAt: evaluation.createdAt,
      nextStep: this.nextStep(evaluation),
    }
  }

  async list(query: ListEvaluationsDto, viewer: StaffPrincipal, ctx: RequestContext) {
    const { page, pageSize, workerId, ...filter } = query
    let subjectId: string | undefined
    if (workerId) {
      const worker = await this.workers.findById(workerId)
      if (!worker) return paginate({ items: [], total: 0 }, { page, pageSize })
      subjectId = worker.pseudonymId
    }

    const result = await this.evaluations.list({ ...filter, subjectId }, { page, pageSize })
    const people = await this.resolveWorkers(result.items)

    await this.audit.record(
      {
        ...this.audit.staff(viewer),
        action: "EVALUATIONS_LISTED",
        entityType: "Evaluation",
        metadata: { count: result.items.length, page, status: filter.status ?? null, byWorker: Boolean(workerId) },
      },
      ctx,
    )
    const items = result.items.map((e) => this.toStaffDto(e, people, false))
    return paginate({ items, total: result.total }, { page, pageSize })
  }

  async getById(id: string, viewer: StaffPrincipal, ctx: RequestContext) {
    const evaluation = await this.findOrFail(id)
    const people = await this.resolveWorkers([evaluation])
    await this.audit.record(
      { ...this.audit.staff(viewer), action: "EVALUATION_VIEWED", entityType: "Evaluation", entityId: id },
      ctx,
    )
    return this.toStaffDto(evaluation, people, true)
  }

  /** Revisión del supervisor HSE: decisión, observación (cifrada) y ajuste justificado del dictamen */
  async review(id: string, dto: ReviewEvaluationDto, reviewer: StaffPrincipal, ctx: RequestContext) {
    const evaluation = await this.findOrFail(id)
    if (evaluation.voidedAt) throw Errors.conflict("La evaluación está anulada", "EVALUATION_VOIDED")

    // Separación de funciones: nadie revisa ni autoriza su propia evaluación
    const reviewerRecord = await this.workers.findById(reviewer.workerId)
    if (reviewerRecord && reviewerRecord.pseudonymId === evaluation.subjectId) {
      throw Errors.forbidden("Otro supervisor debe revisar tu evaluación.", "SELF_REVIEW_NOT_ALLOWED")
    }

    const changes: EvaluationChanges = { reviewedById: reviewer.workerId, reviewedAt: this.now() }
    if (dto.status) changes.status = dto.status
    if (dto.decision) changes.supervisorDecision = dto.decision
    if (dto.note) changes.supervisorNoteEncrypted = this.cipher.encrypt(dto.note, NOTE_CONTEXT)

    const updated = await this.evaluations.update(id, changes)
    await this.audit.record(
      {
        ...this.audit.staff(reviewer),
        action: "EVALUATION_REVIEWED",
        entityType: "Evaluation",
        entityId: id,
        metadata: {
          statusFrom: evaluation.status,
          statusTo: updated.status,
          decision: dto.decision ?? null,
          noteUpdated: Boolean(dto.note),
        },
      },
      ctx,
    )
    return this.toStaffDto(updated, await this.resolveWorkers([updated]), true)
  }

  /** Anulación justificada: el registro se conserva, marcado y excluido de las reglas y listados */
  async void(id: string, dto: VoidEvaluationDto, actor: StaffPrincipal, ctx: RequestContext) {
    const evaluation = await this.findOrFail(id)
    if (evaluation.voidedAt) throw Errors.conflict("La evaluación ya está anulada", "EVALUATION_VOIDED")

    const updated = await this.evaluations.update(id, {
      voidedAt: this.now(),
      voidReason: dto.reason,
      voidedById: actor.workerId,
    })
    await this.audit.record(
      {
        ...this.audit.staff(actor),
        action: "EVALUATION_VOIDED",
        entityType: "Evaluation",
        entityId: id,
        metadata: { reason: dto.reason },
      },
      ctx,
    )
    return this.toStaffDto(updated, await this.resolveWorkers([updated]), true)
  }

  private async findOrFail(id: string): Promise<EvaluationRecord> {
    const evaluation = await this.evaluations.findById(id)
    if (!evaluation) throw Errors.notFound("Evaluación")
    return evaluation
  }

  private retestAvailableAt(evaluation: EvaluationRecord): Date {
    return new Date(evaluation.createdAt.getTime() + this.settings.retestCooldownMinutes * 60_000)
  }

  private nextStep(evaluation: EvaluationRecord) {
    switch (evaluation.status) {
      case "VERDE":
        return { action: "INGRESO_AUTORIZADO" as const }
      case "AMARILLO":
        return { action: "DESCANSO_Y_REEVALUACION" as const, retestAvailableAt: this.retestAvailableAt(evaluation) }
      case "ROJO":
        return { action: "CONTACTAR_SUPERVISOR" as const }
    }
  }

  /**
   * Re-identificación controlada (solo SUPERVISOR / ADMIN): seudónimos de las evaluaciones
   * + revisores/anuladores → trabajadores. Una sola consulta por tipo de id.
   */
  private async resolveWorkers(evaluations: EvaluationRecord[]) {
    const subjectIds = [...new Set(evaluations.map((e) => e.subjectId))]
    const staffIds = [
      ...new Set(evaluations.flatMap((e) => [e.reviewedById, e.voidedById]).filter((v): v is string => v !== null)),
    ]
    const [subjects, staff] = await Promise.all([
      this.workers.findByPseudonymIds(subjectIds),
      Promise.all(staffIds.map((id) => this.workers.findById(id))),
    ])
    return {
      bySubject: new Map(subjects.map((w) => [w.pseudonymId, w])),
      byId: new Map(staff.filter((w): w is WorkerRecord => w !== null).map((w) => [w.id, w])),
    }
  }

  private toStaffDto(
    e: EvaluationRecord,
    people: { bySubject: Map<string, WorkerRecord>; byId: Map<string, WorkerRecord> },
    includeNote: boolean,
  ) {
    const subject = people.bySubject.get(e.subjectId)
    const staffRef = (id: string | null) => {
      if (!id) return null
      const w = people.byId.get(id)
      return w ? { id: w.id, fichaId: w.fichaId, fullName: w.fullName } : { id }
    }
    return {
      id: e.id,
      createdAt: e.createdAt,
      worker: subject
        ? { id: subject.id, fichaId: subject.fichaId, fullName: subject.fullName, position: subject.position, crew: subject.crew }
        : null,
      totem: { id: e.totemId, name: e.totemName },
      metrics: {
        meanLatencyMs: e.meanLatencyMs,
        medianReactionTimeMs: e.medianReactionTimeMs,
        omissions: e.omissions,
        falseStarts: e.falseStarts,
        totalStimuli: e.totalStimuli,
        durationSeconds: e.durationSeconds,
      },
      score: e.score,
      computedStatus: e.computedStatus,
      status: e.status,
      scoringVersion: e.scoringVersion,
      retestAvailableAt: e.status === "AMARILLO" ? this.retestAvailableAt(e) : null,
      review: e.reviewedAt
        ? {
            decision: e.supervisorDecision,
            hasNote: e.supervisorNoteEncrypted !== null,
            ...(includeNote && e.supervisorNoteEncrypted
              ? { note: this.cipher.decrypt(e.supervisorNoteEncrypted, NOTE_CONTEXT) }
              : {}),
            reviewedBy: staffRef(e.reviewedById),
            reviewedAt: e.reviewedAt,
          }
        : null,
      voided: e.voidedAt ? { at: e.voidedAt, reason: e.voidReason, by: staffRef(e.voidedById) } : null,
    }
  }
}
