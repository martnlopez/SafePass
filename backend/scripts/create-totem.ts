// Registra un tótem y muestra su clave UNA sola vez (en la BD solo queda su hash SHA-256).
//   npm run totem:create -- --name "Garita Norte" --location "Acceso principal faena"
import { parseArgs } from "node:util"
import { loadConfig } from "../src/config/env.js"
import { generateDeviceSecret, sha256Hex } from "../src/lib/crypto.js"
import { createPrismaClient } from "../src/lib/prisma.js"
import { PrismaAuditLogRepository } from "../src/repositories/audit-log.repository.js"
import { PrismaTotemRepository } from "../src/repositories/totem.repository.js"

const { values } = parseArgs({
  options: { name: { type: "string" }, location: { type: "string" } },
})

const name = values.name?.trim()
if (!name || name.length < 3 || name.length > 80) {
  console.error('Uso: npm run totem:create -- --name "Garita Norte" [--location "Acceso principal"]')
  process.exit(1)
}

const config = loadConfig()
if (!config.DATABASE_URL) {
  console.error("Este script necesita DATABASE_URL (la base del tótem y del panel).")
  process.exit(1)
}
const prisma = createPrismaClient(config.DATABASE_URL)

try {
  const secret = generateDeviceSecret()
  const totem = await new PrismaTotemRepository(prisma).create({
    name,
    location: values.location?.trim() || null,
    keyHash: sha256Hex(secret),
  })
  await new PrismaAuditLogRepository(prisma).append({
    actorType: "SYSTEM",
    actorId: null,
    action: "TOTEM_CREATED",
    entityType: "Totem",
    entityId: totem.id,
    metadata: { name },
  })

  console.log(`\nTótem creado: ${totem.name} (${totem.id})`)
  console.log("\nConfigura este valor en el dispositivo (header X-Totem-Key). No se volverá a mostrar:\n")
  console.log(`  ${totem.id}.${secret}\n`)
} finally {
  await prisma.$disconnect()
}
