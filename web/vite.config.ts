import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// the app is served under /finance-tracker/ (must match BASE_PATH in server/src/index.js)
const base = '/finance-tracker/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Finance Tracker',
        short_name: 'Finance',
        description: 'Spending, investments and savings in one place',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the app shell is precached; API data is saved and queued by the app itself (src/offline.ts)
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/finance-tracker\/api/],
      },
    }),
  ],
  server: {
    host: true,
    proxy: { [`${base}api`]: `http://localhost:${process.env.API_PORT || 3001}` },
  },
})
