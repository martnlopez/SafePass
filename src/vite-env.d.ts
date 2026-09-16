import { defineConfig } from 'vite'
import react from '@vitejs.plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SAFEPASS - Control de Aptitud Cognitiva',
        short_name: 'SAFEPASS',
        description: 'Evaluación de aptitud operativa en faena minera',
        theme_color: '#0f2b5c',
        background_color: '#0f2b5c',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})