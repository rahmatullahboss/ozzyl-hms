import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['offline.html', 'ozzyl-logo.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'Ozzyl HMS — Hospital Management System',
        short_name: 'HMS',
        description: 'Secure, modern SaaS for healthcare providers in Bangladesh.',
        theme_color: '#0d9488',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/patient/login',
        scope: '/',
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
        // Keep existing tabs stable; updates are picked up on the next normal navigation.
        skipWaiting: false,
        clientsClaim: false,
        // Remove old precache entries when a new SW activates
        cleanupOutdatedCaches: true,
        // Do not register a navigation fallback here. The Cloudflare Worker
        // already serves the SPA shell for hospital routes; Workbox
        // navigateFallback would intercept every dashboard navigation and can
        // replace an online page with the offline screen.
        navigateFallback: null,
        runtimeCaching: [
          {
            // SECURITY (P0-35): Only PUBLIC API paths may be cached. The
            // previous rule `/^.*\/api\/.*/` runtime-cached every
            // authenticated /api/* response for 1 hour, which leaked PII
            // across users of the same browser and across logout/re-login.
            // The route below matches the PUBLIC_API_PATHS allowlist only;
            // Keep these regexes inline: Workbox serializes this callback into
            // sw.js, so imported symbols are not available at service-worker runtime.
            urlPattern: ({ url }) => {
              if (!url.pathname.startsWith('/api/')) return false;
              if (url.pathname.startsWith('/api/uploads/')) return false;
              return [
                /^\/api\/public\/.+/,
                /^\/api\/push\/vapid-key\/?$/,
              ].some((re) => re.test(url.pathname));
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-api-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60, // 5 minutes max
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
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../packages/shared/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        // Default API port is 8788 (8787 is the wrangler default but is
        // taken on this dev machine by an unrelated service). Override
        // with HMS_API_PORT=… to keep wrangler + Vite proxy in sync.
        target: `http://localhost:${process.env.HMS_API_PORT || '8788'}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === 'true',
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        // Split heavy shared dependencies so one large vendor bundle does not
        // block route-level caching. Route components are already lazy-loaded.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('@tanstack/')) return 'vendor-query';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('pdfjs-dist') || id.includes('@react-pdf/')) return 'vendor-pdf';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n';
          if (id.includes('date-fns') || id.includes('zod')) return 'vendor-utils';
          return 'vendor';
        },
      },
    },
  },
});
