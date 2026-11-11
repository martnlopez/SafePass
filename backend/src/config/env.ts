import { config as loadDotenv } from "dotenv"
import { z } from "zod"

// Carga .env (no sobrescribe variables ya definidas en el entorno)
loadDotenv({ quiet: true })

const key32 = (name: string) =>
  z
    .string()
    .min(1, `${name} es obligatoria`)
    .refine((v) => Buffer.from(v, "base64").length === 32, `${name} debe ser una clave de 32 bytes codificada en base64`)

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

    // Base propia del tótem y del panel. Opcional: sin ella esas rutas responden 503 y el
    // servidor atiende solo la API de la app (/api/v1/app), que trabaja sobre Supabase.
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "DATABASE_URL debe ser una URL de PostgreSQL")
      .optional(),

    CORS_ORIGINS: csv,
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    JSON_BODY_LIMIT: z.string().default("10kb"),

    JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
    JWT_ISSUER: z.string().min(1).default("safepass-api"),
    JWT_AUDIENCE: z.string().min(1).default("safepass-clients"),
    JWT_STAFF_TTL_SECONDS: z.coerce.number().int().min(300).max(43_200).default(3600),
    JWT_TOTEM_SESSION_TTL_SECONDS: z.coerce.number().int().min(120).max(1800).default(600),

    PIN_PEPPER: z.string().min(32, "PIN_PEPPER debe tener al menos 32 caracteres"),
    FIELD_ENCRYPTION_KEY: key32("FIELD_ENCRYPTION_KEY"),
    BLIND_INDEX_KEY: key32("BLIND_INDEX_KEY"),

    // Bloqueo de la cuenta completa: umbral alto para que un tercero no pueda bloquear
    // a otro con pocos intentos (el límite por IP+ficha frena la adivinación desde una IP)
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(5).max(100).default(20),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RETEST_COOLDOWN_MINUTES: z.coerce.number().int().min(0).max(120).default(5),

    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_LOGIN_PER_ACCOUNT_MAX: z.coerce.number().int().min(1).default(5),
    RATE_LIMIT_EVALUATIONS_PER_MINUTE: z.coerce.number().int().min(1).default(20),

    // API de la app (/api/v1/app): proyecto Supabase con sus datos. Solo la URL y la clave
    // PUBLICABLE: el backend actúa con el token de cada usuario, nunca con service_role.
    SUPABASE_URL: z.url().optional(),
    SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .min(10)
      .refine((k) => !k.startsWith("sb_secret_"), "Usa la clave publicable, no la secreta")
      .optional(),
    SUPABASE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  })
  .superRefine((env, ctx) => {
    if (env.FIELD_ENCRYPTION_KEY === env.BLIND_INDEX_KEY) {
      ctx.addIssue({ code: "custom", path: ["BLIND_INDEX_KEY"], message: "Debe ser distinta de FIELD_ENCRYPTION_KEY" })
    }
    if (Boolean(env.SUPABASE_URL) !== Boolean(env.SUPABASE_PUBLISHABLE_KEY)) {
      ctx.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY van juntas" })
    }
    if (!env.DATABASE_URL && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Configura DATABASE_URL (tótem y panel) o SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (API de la app)",
      })
    }
    if (env.NODE_ENV === "production") {
      if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes("*")) {
        ctx.addIssue({ code: "custom", path: ["CORS_ORIGINS"], message: "En producción debe listar orígenes explícitos (sin *)" })
      }
    }
  })

export type AppConfig = z.infer<typeof EnvSchema>

/** Valida las variables de entorno. Nunca imprime valores, solo nombres y motivos. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // Una variable opcional vacía ("DATABASE_URL=") equivale a no definirla
  const cleaned = { ...source }
  for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) {
    if (cleaned[name]?.trim() === "") delete cleaned[name]
  }
  const parsed = EnvSchema.safeParse(cleaned)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
    throw new Error(`Configuración inválida. Revisa tu archivo .env:\n${lines.join("\n")}`)
  }
  return parsed.data
}
