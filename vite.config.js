import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Content Security Policy para la compilación de producción: el navegador solo
// ejecuta scripts propios y solo se conecta a Supabase. Mitiga inyección de scripts
// (XSS) y exfiltración de datos. En desarrollo no se aplica porque Vite usa scripts
// en línea para la recarga en caliente.
// Nota: frame-ancestors (anti-clickjacking) no funciona en <meta>; debe enviarse como
// cabecera HTTP desde el hosting.
const DEFAULT_API_URL = 'http://localhost:3000/api/v1'

function contentSecurityPolicy(supabaseUrl, apiUrl, turnstileSiteKey) {
  const supabase = supabaseUrl ? new URL(supabaseUrl) : null
  // La app llama a la API SafePass (backend) y, para login y paneles en vivo, a Supabase
  const api = new URL(apiUrl || DEFAULT_API_URL)
  const connect = [api.origin, supabase ? `https://${supabase.host} wss://${supabase.host}` : ''].join(' ').trim()
  // CAPTCHA (Cloudflare Turnstile): solo se abre la CSP si está configurado
  const captcha = turnstileSiteKey ? 'https://challenges.cloudflare.com' : ''
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${captcha}`.trim(),
    ...(captcha ? [`frame-src ${captcha}`] : []),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${connect}`.trim(),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'safepass-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL, env.VITE_API_URL, env.VITE_TURNSTILE_SITE_KEY),
      VitePWA({
        // La versión nueva espera hasta que la app decida aplicarla (src/lib/appUpdate.ts):
        // así nunca se recarga en medio de un test
        registerType: 'prompt',
        manifest: {
          name: 'SAFEPASS - Control de Aptitud Cognitiva',
          short_name: 'SAFEPASS',
          description: 'Evaluación de aptitud operativa en faena minera',
          theme_color: '#0f2b5c',
          background_color: '#0f2b5c',
          display: 'standalone',
          orientation: 'portrait'
        }
      })
    ]
  }
})
