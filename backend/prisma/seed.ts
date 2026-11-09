// Seed inicial: crea la cuenta ADMIN desde variables de entorno (nunca credenciales en el código).
// Opcional: SEED_DEMO_WORKERS=true crea cuentas ficticias de demostración.
//   npm run db:seed
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { loadConfig } from "../src/config/env.js"
import { FieldCipher } from "../src/lib/crypto.js"
import { PinHasher } from "../src/lib/pin.js"
import { createPrismaClient } from "../src/lib/prisma.js"
import { computeCheckDigit } from "../src/lib/rut.js"
import { PrismaAuditLogRepository } from "../src/repositories/audit-log.repository.js"
import { PrismaWorkerRepository } from "../src/repositories/worker.repository.js"
import { CreateWorkerBody, type CreateWorkerDto } from "../src/schemas/worker.schema.js"
import { RUT_CONTEXT } from "../src/services/worker.service.js"

const config = loadConfig()

const SeedEnv = z.object({
  SEED_ADMIN_FICHA: z.string().min(1, "Define SEED_ADMIN_FICHA en .env"),
  SEED_ADMIN_RUT: z.string().min(1, "Define SEED_ADMIN_RUT en .env"),
  SEED_ADMIN_NAME: z.string().min(1, "Define SEED_ADMIN_NAME en .env"),
  SEED_ADMIN_PIN: z.string().min(1, "Define SEED_ADMIN_PIN en .env"),
  SEED_DEMO_WORKERS: z.enum(["true", "false"]).default("false"),
  SEED_DEMO_PIN: z.string().optional(),
})

const env = SeedEnv.safeParse(process.env)
if (!env.success) {
  console.error(env.error.issues.map((i) => `  - ${i.message}`).join("\n"))
  process.exit(1)
}

const prisma = createPrismaClient(config.DATABASE_URL)
const workers = new PrismaWorkerRepository(prisma)
const audit = new PrismaAuditLogRepository(prisma)
const cipher = new FieldCipher(config.FIELD_ENCRYPTION_KEY, config.BLIND_INDEX_KEY)
const pins = new PinHasher(config.PIN_PEPPER)

async function ensureWorker(input: unknown) {
  const dto: CreateWorkerDto = CreateWorkerBody.parse(input)
  if (await workers.findByFichaId(dto.fichaId)) {
    console.log(`  = ${dto.fichaId} ya existe, se omite`)
    return
  }
  const worker = await workers.create({
    pseudonymId: randomUUID(),
    fichaId: dto.fichaId,
    rutEncrypted: cipher.encrypt(dto.rut, RUT_CONTEXT),
    rutHash: cipher.blindIndex(dto.rut, RUT_CONTEXT),
    fullName: dto.fullName,
    position: dto.position,
    company: dto.company ?? null,
    crew: dto.crew,
    role: dto.role,
    pinHash: await pins.hash(dto.pin),
  })
  await audit.append({
    actorType: "SYSTEM",
    actorId: null,
    action: "WORKER_CREATED",
    entityType: "Worker",
    entityId: worker.id,
    metadata: { role: worker.role, source: "seed" },
  })
  console.log(`  + ${worker.fichaId} (${worker.role})`)
}

/** RUT ficticio válido a partir de un cuerpo numérico */
const demoRut = (body: string) => `${body}-${computeCheckDigit(body)}`

try {
  console.log("Seed SafePass")
  await ensureWorker({
    fichaId: env.data.SEED_ADMIN_FICHA,
    rut: env.data.SEED_ADMIN_RUT,
    fullName: env.data.SEED_ADMIN_NAME,
    position: "Administrador del sistema",
    crew: "7x7",
    role: "ADMIN",
    pin: env.data.SEED_ADMIN_PIN,
  })

  if (env.data.SEED_DEMO_WORKERS === "true") {
    if (!env.data.SEED_DEMO_PIN) throw new Error("SEED_DEMO_WORKERS=true requiere SEED_DEMO_PIN")
    const pin = env.data.SEED_DEMO_PIN
    // Mismas fichas de prueba que usa el frontend (datos ficticios)
    await ensureWorker({ fichaId: "TRB-0513", rut: demoRut("20000513"), fullName: "Supervisora Demo", position: "Supervisora HSE", crew: "7x7", role: "SUPERVISOR", pin })
    await ensureWorker({ fichaId: "TRB-0512", rut: demoRut("20000512"), fullName: "Operador Demo", position: "Operador CAEX", company: "Contratista Demo", crew: "7x7", role: "OPERATOR", pin })
    await ensureWorker({ fichaId: "TRB-0431", rut: demoRut("20000431"), fullName: "Operadora Demo", position: "Operadora Perforadora", company: "Contratista Demo", crew: "4x3", role: "OPERATOR", pin })
  }
  console.log("Listo.")
} finally {
  await prisma.$disconnect()
}
