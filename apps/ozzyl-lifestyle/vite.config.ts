import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/patient/',
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Ozzyl HMS — Hospital Management System',
        short_name: 'HMS',
        description: 'Secure, modern SaaS for healthcare providers in Bangladesh.',
        theme_color: '#6366f1',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/patient/login',
        scope: '/patient/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Allow larger JS bundles to be precached (default is 2 MiB).
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // Exclude HTML from precache so index.html is always fetched from the
        // network (served by the Cloudflare Worker). This ensures users always
        // get the latest JS bundle references after deployment.
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        // Immediately activate new service workers (no waiting for tab close)
        skipWaiting: true,
        clientsClaim: true,
        // Remove old precache entries when a new SW activates
        cleanupOutdatedCaches: true,
        // Offline fallback — show offline.html when navigation fails
        navigateFallback: '/patient/offline.html',
        // Only fallback for navigation requests to non-API, non-asset paths
        navigateFallbackDenylist: [/^\/api\//, /^\/site\//, /\.\w+$/],
        runtimeCaching: [
          {
            // Network-first for all API calls
            urlPattern: /^.*\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Stale-while-revalidate for uploaded images
            urlPattern: /^.*\/api\/uploads\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'uploads-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache-first for Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // Enable PWA in dev mode for testing
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../web/dist/patient',
    emptyOutDir: true,
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
  },
});
