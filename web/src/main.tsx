import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/dashboard/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import './lib/i18n';
import './index.css';
import { syncEngine } from './lib/sync-engine';
import { isPublicApiPath } from './lib/api-paths';
import { refreshStaleHmsServiceWorker } from './lib/serviceWorkerReset';

const fallbackTranslate = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as typeof globalThis.t;

globalThis.t = fallbackTranslate;

if (typeof window !== 'undefined') {
  window.addEventListener('wheel', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'number' && document.activeElement === target) {
      event.preventDefault();
    }
  }, { passive: false });
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let hasReloadedForServiceWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.sessionStorage.getItem('hms-sw-user-refresh') !== '1') return;
    if (hasReloadedForServiceWorker) return;
    hasReloadedForServiceWorker = true;
    window.sessionStorage.removeItem('hms-sw-user-refresh');
    window.location.reload();
  });

  void refreshStaleHmsServiceWorker(
    navigator.serviceWorker,
    window.localStorage,
    window.location.origin,
    () => window.sessionStorage.setItem('hms-sw-user-refresh', '1'),
  ).catch(() => {
    // Best-effort migration: retry on a later load if the update check fails.
  });

  // SECURITY (P0-35): defensively purge any cached responses for
  // authenticated /api/* paths. Workbox's runtimeCaching rules now only
  // match PUBLIC_API_PATH_PATTERNS, but older installed service workers
  // may still have a `api-cache` CacheStorage with authenticated responses.
  // On install / activate we delete that cache and any other /api/
  // entries that aren't on the public allowlist.
  async function purgeAuthApiCache(): Promise<void> {
    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name === 'api-cache' || name === 'public-api-cache') {
          await caches.delete(name);
          continue;
        }
        const cache = await caches.open(name);
        const requests = await cache.keys();
        for (const req of requests) {
          try {
            const url = new URL(req.url);
            if (url.pathname.startsWith('/api/') && !isPublicApiPath(url.pathname)) {
              await cache.delete(req);
            }
          } catch {
            // skip malformed URLs
          }
        }
      }
    } catch {
      // best-effort purge; nothing critical
    }
  }
  void purgeAuthApiCache();
}

// Browser offline replay is important, but checking/decrypting IndexedDB does
// not need to compete with React's first paint. Start it after the browser gets
// an idle window, with a short timeout fallback so queued writes still replay.
if (typeof window !== 'undefined') {
  const startBackgroundSync = () => syncEngine.start();
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startBackgroundSync, { timeout: 1500 });
  } else {
    window.setTimeout(startBackgroundSync, 250);
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>}>
              <App />
            </Suspense>
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);