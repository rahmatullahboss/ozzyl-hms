import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/dashboard/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import './lib/i18n';
import './lib/axiosSetup';
import './index.css';
import { syncEngine } from './lib/sync-engine';

const fallbackTranslate = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as typeof globalThis.t;

globalThis.t = fallbackTranslate;

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let hasReloadedForServiceWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.sessionStorage.getItem('hms-sw-user-refresh') !== '1') return;
    if (hasReloadedForServiceWorker) return;
    hasReloadedForServiceWorker = true;
    window.sessionStorage.removeItem('hms-sw-user-refresh');
    window.location.reload();
  });
}

// Start background sync engine (processes offline queue when connection restores)
syncEngine.start();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
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
