import { randomUUID } from "node:crypto"
import { Errors } from "../errors/app-error.js"
import type { FieldCipher } from "../lib/crypto.js"
import type { PinHasher } from "../lib/pin.js"
import { formatRut, maskRut } from "../lib/rut.js"
import type { WorkerChanges, WorkerRepository } from "../repositories/worker.repository.js"
import type { CreateWorkerDto, ListWorkersDto, UpdateWorkerDto } from "../schemas/worker.schema.js"
import type { StaffPrincipal } from "../types/auth.js"
import { paginate, type RequestContext, type WorkerRecord } from "../types/domain.js"
import type { AuditService } from "./audit.service.js"

export const RUT_CONTEXT = "worker.rut"

export class WorkerService {
  constructor(
    private readonly workers: WorkerRepository,
    private readonly cipher: FieldCipher,
    private readonly pins: PinHasher,
    private readonly audit: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(dto: CreateWorkerDto, actor: StaffPrincipal, ctx: RequestContext) {
    const rutHash = this.cipher.blindIndex(dto.rut, RUT_CONTEXT)
    if (await this.workers.findByFichaId(dto.fichaId)) throw Errors.conflict("La Ficha ID ya está registrada", "FICHA_TAKEN")
    if (await this.workers.findByRutHash(rutHash)) throw Errors.conflict("El RUT ya está registrado", "RUT_TAKEN")

    const worker = await this.workers.create({
      // Seudónimo UUID v4 aleatorio: es lo único que se guarda en las evaluaciones
      pseudonymId: randomUUID(),
      fichaId: dto.fichaId,
      rutEncrypted: this.cipher.encrypt(dto.rut, RUT_CONTEXT),
      rutHash,
      fullName: dto.fullName,
      position: dto.position,
      company: dto.company ?? null,
      crew: dto.crew,
      role: dto.role,
      pinHash: await this.pins.hash(dto.pin),
    })

    await this.audit.record(
      {
        ...this.audit.staff(actor),
        action: "WORKER_CREATED",
        entityType: "Worker",
        entityId: worker.id,
        metadata: { role: worker.role, crew: worker.crew },
      },
      ctx,
    )
    return this.toDto(worker, actor)
  }

  async list(query: ListWorkersDto, viewer: StaffPrincipal) {
    const { page, pageSize, ...filter } = query
    const result = await this.workers.list(filter, { page, pageSize })
    return paginate({ ...result, items: result.items.map((w) => this.toDto(w, viewer)) }, { page, pageSize })
  }

  async getById(id: string, viewer: StaffPrincipal, ctx: RequestContext) {
    const worker = await this.findOrFail(id)
    await this.audit.record({ ...this.audit.staff(viewer), action: "WORKER_VIEWED", entityType: "Worker", entityId: id }, ctx)
    return this.toDto(worker, viewer)
  }

  async update(id: string, dto: UpdateWorkerDto, actor: StaffPrincipal, ctx: RequestContext) {
    const worker = await this.findOrFail(id)
    if (id === actor.workerId && ((dto.role && dto.role !== worker.role) || dto.active === false)) {
      throw Errors.forbidden("No puedes cambiar tu propio rol ni desactivar tu propia cuenta", "SELF_MODIFICATION")
    }

    const { pin, active, ...fields } = dto
    const changes: WorkerChanges = { ...fields }
    if (active !== undefined && active !== worker.active) {
      changes.active = active
      changes.deactivatedAt = active ? null : this.now()
    }
    if (pin) {
      changes.pinHash = await this.pins.hash(pin)
      changes.failedLoginAttempts = 0
      changes.lockedUntil = null
    }

    const updated = await this.workers.update(id, changes)
    await this.audit.record(
      {
        ...this.audit.staff(actor),
        action: "WORKER_UPDATED",
        entityType: "Worker",
        entityId: id,
        // Solo nombres de campos, nunca valores
        metadata: { fields: Object.keys(dto).filter((k) => dto[k as keyof UpdateWorkerDto] !== undefined) },
      },
      ctx,
    )
    return this.toDto(updated, actor)
  }

  /** Soft-delete: se desactiva la cuenta y se conserva el historial */
  async deactivate(id: string, actor: StaffPrincipal, ctx: RequestContext) {
    if (id === actor.workerId) {
      throw Errors.forbidden("No puedes desactivar tu propia cuenta", "SELF_MODIFICATION")
    }
    const worker = await this.findOrFail(id)
    if (!worker.active) return this.toDto(worker, actor)

    const updated = await this.workers.update(id, { active: false, deactivatedAt: this.now() })
    await this.audit.record(
      { ...this.audit.staff(actor), action: "WORKER_DEACTIVATED", entityType: "Worker", entityId: id },
      ctx,
    )
    return this.toDto(updated, actor)
  }

  private async findOrFail(id: string): Promise<WorkerRecord> {
    const worker = await this.workers.findById(id)
    if (!worker) throw Errors.notFound("Trabajador")
    return worker
  }

  /** Nunca expone pinHash, rutHash ni el seudónimo. RUT completo solo para ADMIN. */
  private toDto(worker: WorkerRecord, viewer: StaffPrincipal) {
    const rut = this.cipher.decrypt(worker.rutEncrypted, RUT_CONTEXT)
    return {
      id: worker.id,
      fichaId: worker.fichaId,
      rut: viewer.role === "ADMIN" ? formatRut(rut) : maskRut(rut),
      fullName: worker.fullName,
      position: worker.position,
      company: worker.company,
      crew: worker.crew,
      role: worker.role,
      active: worker.active,
      locked: worker.lockedUntil !== null && worker.lockedUntil > this.now(),
      createdAt: worker.createdAt,
      updatedAt: worker.updatedAt,
      deactivatedAt: worker.deactivatedAt,
    }
  }
}
