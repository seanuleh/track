import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Weight Tracker',
        short_name: 'Track',
        description: 'Personal weight tracking',
        theme_color: '#3b5bdb',
        background_color: '#f2f4f7',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the content-hashed bundle (JS/CSS/fonts/icons) so the app shell paints
        // instantly on launch. Safe because Vite hashes these filenames → immutable; a deploy
        // produces new names + a new precache manifest (autoUpdate + skipWaiting swaps it in).
        // index.html is deliberately NOT precached: it must stay network-live so nginx can
        // inject the per-request cf-auth sub_filter script. navigateFallback:null keeps every
        // navigation on the network (see cfAuth Lesson #9 — cached HTML causes a login loop).
        globPatterns: ['**/*.{js,css,woff2,woff,png,svg}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        ws: true,
      }
    }
  }
})
