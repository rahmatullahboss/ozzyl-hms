export type VisiblePwaPrompt = 'offline-ready' | 'refresh' | 'install' | 'push';
const FALLBACK_APP_ICON = '/apple-touch-icon.png';
export const PWA_PROMPT_DISMISS_KEY = 'ozzyl_pwa_prompt_dismissed';

export interface PwaPromptState {
  needRefresh: boolean;
  offlineReady: boolean;
  hasInstallPrompt: boolean;
  pushSupported: boolean;
  pushPermission: NotificationPermission | 'default';
  isPushSubscribed: boolean;
  dismissedPrompt: VisiblePwaPrompt | null;
}

export function readDismissedPwaPrompt(storageValue: string | null | undefined): VisiblePwaPrompt | null {
  if (
    storageValue === 'offline-ready' ||
    storageValue === 'refresh' ||
    storageValue === 'install' ||
    storageValue === 'push'
  ) {
    return storageValue;
  }

  return null;
}

export function getVisiblePwaPrompt(state: PwaPromptState): VisiblePwaPrompt | null {
  if (state.needRefresh) {
    return state.dismissedPrompt === 'refresh' ? null : 'refresh';
  }

  if (state.offlineReady) {
    return state.dismissedPrompt === 'offline-ready' ? null : 'offline-ready';
  }

  if (state.hasInstallPrompt) {
    return state.dismissedPrompt === 'install' ? null : 'install';
  }

  const canShowPushPrompt =
    state.pushSupported &&
    state.pushPermission === 'default' &&
    !state.isPushSubscribed;

  if (canShowPushPrompt) {
    return state.dismissedPrompt === 'push' ? null : 'push';
  }

  return null;
}

export function getPwaIconHref(hospitalLogoUrl: string | null | undefined): string {
  return hospitalLogoUrl?.trim() || FALLBACK_APP_ICON;
}

export function buildDynamicManifest(hospitalLogoUrl: string | null | undefined) {
  const iconHref = getPwaIconHref(hospitalLogoUrl);

  return {
    name: 'Ozzyl HMS — Hospital Management System',
    short_name: 'HMS',
    description: 'Secure, modern SaaS for healthcare providers in Bangladesh.',
    start_url: '/patient/login',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#6366f1',
    lang: 'en',
    scope: '/',
    orientation: 'portrait',
    icons: [
      {
        src: iconHref,
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: iconHref,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}

export function applyPwaIcons(hospitalLogoUrl: string | null | undefined) {
  if (typeof document === 'undefined') return;

  const href = getPwaIconHref(hospitalLogoUrl);
  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector<HTMLLinkElement>(selector);
    if (element) {
      element.href = href;
    }
  }
}

export function applyDynamicManifest(hospitalLogoUrl: string | null | undefined) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;

  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifestLink) return;

  const manifest = buildDynamicManifest(hospitalLogoUrl);
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  const nextHref = URL.createObjectURL(blob);
  const previousHref = manifestLink.dataset.dynamicManifestHref;

  manifestLink.href = nextHref;
  manifestLink.dataset.dynamicManifestHref = nextHref;

  if (previousHref) {
    URL.revokeObjectURL(previousHref);
  }
}
