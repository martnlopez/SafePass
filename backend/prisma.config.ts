import { config as loadEnv } from "dotenv"
import { defineConfig } from "prisma/config"

// Prisma 7 no carga .env por sí mismo: lo hacemos explícito aquí.
loadEnv({ quiet: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "",
  },
})
