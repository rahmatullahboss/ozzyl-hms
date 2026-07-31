import { useState, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { usePushNotifications } from '../hooks/usePushNotifications';
import {
  getVisiblePwaPrompt,
  PWA_PROMPT_DISMISS_KEY,
  readDismissedPwaPrompt,
  type VisiblePwaPrompt,
} from '../lib/pwaPrompt';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isBenignPwaRegistrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("reading 'waiting'") || message.includes('Service Worker script evaluation failed');
}

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration: ServiceWorkerRegistration | undefined) {
      console.log('[PWA] Service worker registered:', registration);
      void registration?.update();
    },
    onRegisterError(error: unknown) {
      if (isBenignPwaRegistrationError(error)) {
        return;
      }
      console.error('[PWA] Service worker registration error:', error);
    },
  });

  const {
    isSupported,
    permission,
    isSubscribed,
    loading: pushLoading,
    subscribe: subscribePush,
  } = usePushNotifications();

  // Install prompt state
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissedPrompt, setDismissedPrompt] = useState<VisiblePwaPrompt | null>(() => {
    if (typeof window === 'undefined') return null;
    return readDismissedPwaPrompt(window.localStorage.getItem(PWA_PROMPT_DISMISS_KEY));
  });

  const persistDismissedPrompt = (value: VisiblePwaPrompt | null) => {
    setDismissedPrompt(value);
    if (typeof window === 'undefined') return;
    if (value) {
      window.localStorage.setItem(PWA_PROMPT_DISMISS_KEY, value);
    } else {
      window.localStorage.removeItem(PWA_PROMPT_DISMISS_KEY);
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      persistDismissedPrompt(dismissedPrompt === 'install' ? null : dismissedPrompt);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    if (!needRefresh) return;
    persistDismissedPrompt(dismissedPrompt === 'refresh' ? null : dismissedPrompt);
  }, [dismissedPrompt, needRefresh]);

  useEffect(() => {
    if (offlineReady) {
      persistDismissedPrompt(dismissedPrompt === 'offline-ready' ? null : dismissedPrompt);
    }
  }, [dismissedPrompt, offlineReady]);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
    persistDismissedPrompt('install');
  };

  const activePrompt = getVisiblePwaPrompt({
    needRefresh,
    offlineReady,
    hasInstallPrompt: !!installPrompt,
    pushSupported: isSupported,
    pushPermission: permission,
    isPushSubscribed: isSubscribed,
    dismissedPrompt,
  });

  const promptUiDisabled = true;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    if (activePrompt) {
      persistDismissedPrompt(activePrompt);
    }
  };

  if (promptUiDisabled) return null;
  if (!activePrompt) return null;

  return (
    <div
      className="no-print"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 9999,
        background: '#1e1b4b',
        border: '1px solid #6366f1',
        borderRadius: '0.75rem',
        padding: '1rem 1.25rem',
        color: '#fff',
        boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        maxWidth: '320px',
        fontSize: '0.875rem',
      }}
      role="alert"
      aria-live="polite"
    >
      <p style={{ margin: 0, fontWeight: 500 }}>
        {activePrompt === 'offline-ready'
          ? '✅ অ্যাপ অফলাইনে ব্যবহারের জন্য প্রস্তুত!'
          : activePrompt === 'refresh'
            ? '🔄 নতুন আপডেট পাওয়া গেছে!'
            : activePrompt === 'install'
              ? '📲 অ্যাপটি ইনস্টল করুন — দ্রুত অ্যাক্সেসের জন্য'
              : '🔔 নোটিফিকেশন চালু করুন — গুরুত্বপূর্ণ আপডেট পেতে'}
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        {activePrompt === 'refresh' && (
          <button
            onClick={() => {
              window.sessionStorage.setItem('hms-sw-user-refresh', '1');
              void updateServiceWorker(true);
            }}
            style={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8rem',
            }}
          >
            আপডেট করুন
          </button>
        )}
        {activePrompt === 'install' && (
          <button
            onClick={handleInstall}
            style={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8rem',
            }}
          >
            📲 ইনস্টল করুন
          </button>
        )}
        {activePrompt === 'push' && (
          <button
            onClick={subscribePush}
            disabled={pushLoading}
            style={{
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8rem',
              opacity: pushLoading ? 0.6 : 1,
            }}
          >
            {pushLoading ? '...' : '🔔 চালু করুন'}
          </button>
        )}
        <button
          onClick={close}
          style={{
            background: 'transparent',
            color: '#a5b4fc',
            border: '1px solid #4338ca',
            borderRadius: '0.5rem',
            padding: '0.375rem 0.75rem',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          বন্ধ করুন
        </button>
      </div>
    </div>
  );
}
