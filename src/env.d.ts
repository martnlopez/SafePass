/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del proyecto Supabase (ej. https://xxxx.supabase.co) */
  readonly VITE_SUPABASE_URL: string
  /** Clave publicable de Supabase: es pública por diseño; la seguridad la dan las reglas RLS */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** API SafePass (backend Express), ej. http://localhost:3000/api/v1 */
  readonly VITE_API_URL?: string
  /** Clave pública (site key) de Cloudflare Turnstile. Vacía = CAPTCHA apagado */
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
