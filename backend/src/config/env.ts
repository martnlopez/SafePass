import { config as loadDotenv } from "dotenv"
import { z } from "zod"

// Carga .env (no sobrescribe variables ya definidas en el entorno)
loadDotenv({ quiet: true })

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    CORS_ORIGINS: csv,
    // Detrás de un proxy/balanceador: número de saltos confiables (necesario para req.ip y los límites por IP)
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    JSON_BODY_LIMIT: z.string().default("10kb"),

    // Límites de tasa por IP (anti scraping y anti fuerza bruta)
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),

    // Proyecto Supabase con los datos de la app. Solo la URL y la clave PUBLICABLE: el backend
    // actúa con el token de cada usuario (RLS y reglas en la base), nunca con service_role.
    SUPABASE_URL: z.url("SUPABASE_URL debe ser la URL del proyecto (https://xxxx.supabase.co)"),
    SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .min(10, "SUPABASE_PUBLISHABLE_KEY es obligatoria")
      .refine((k) => !k.startsWith("sb_secret_"), "Usa la clave publicable, no la secreta"),
    SUPABASE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes("*")) {
        ctx.addIssue({ code: "custom", path: ["CORS_ORIGINS"], message: "En producción debe listar orígenes explícitos (sin *)" })
      }
    }
  })

export type AppConfig = z.infer<typeof EnvSchema>

/** Valida las variables de entorno. Nunca imprime valores, solo nombres y motivos. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
    throw new Error(`Configuración inválida. Revisa tu archivo .env:\n${lines.join("\n")}`)
  }
  return parsed.data
}
