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
function contentSecurityPolicy(supabaseUrl) {
  const supabase = supabaseUrl ? new URL(supabaseUrl) : null
  const connect = supabase ? `https://${supabase.host} wss://${supabase.host}` : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
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
      contentSecurityPolicy(env.VITE_SUPABASE_URL),
      VitePWA({
        registerType: 'autoUpdate',
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
