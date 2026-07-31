import { describe, expect, it } from 'vitest';
import {
  getVisiblePwaPrompt,
  getPwaIconHref,
  buildDynamicManifest,
  readDismissedPwaPrompt,
  type PwaPromptState,
} from '../../web/src/lib/pwaPrompt';

describe('pwa prompt helpers', () => {
  it('hides the push prompt after it is dismissed', () => {
    const state: PwaPromptState = {
      needRefresh: false,
      offlineReady: false,
      hasInstallPrompt: false,
      pushSupported: true,
      pushPermission: 'default',
      isPushSubscribed: false,
      dismissedPrompt: 'push',
    };

    expect(getVisiblePwaPrompt(state)).toBe(null);
  });

  it('shows the push prompt when notifications are available and not dismissed', () => {
    const state: PwaPromptState = {
      needRefresh: false,
      offlineReady: false,
      hasInstallPrompt: false,
      pushSupported: true,
      pushPermission: 'default',
      isPushSubscribed: false,
      dismissedPrompt: null,
    };

    expect(getVisiblePwaPrompt(state)).toBe('push');
  });

  it('accepts only valid stored prompt dismiss values', () => {
    expect(readDismissedPwaPrompt('push')).toBe('push');
    expect(readDismissedPwaPrompt('install')).toBe('install');
    expect(readDismissedPwaPrompt('invalid')).toBe(null);
    expect(readDismissedPwaPrompt(null)).toBe(null);
  });

  it('prefers the current hospital logo for app icons when available', () => {
    expect(getPwaIconHref('/api/settings/logo')).toBe('/api/settings/logo');
  });

  it('falls back to the bundled app icon when no hospital logo exists', () => {
    expect(getPwaIconHref(null)).toBe('/apple-touch-icon.png');
  });

  it('uses the hospital logo in the dynamic manifest when available', () => {
    const manifest = buildDynamicManifest('data:image/png;base64,abc');

    expect(manifest.icons).toEqual([
      {
        src: 'data:image/png;base64,abc',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: 'data:image/png;base64,abc',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ]);
  });

  it('keeps the fallback icon in the dynamic manifest when no logo exists', () => {
    const manifest = buildDynamicManifest(null);

    expect(manifest.icons[0]?.src).toBe('/apple-touch-icon.png');
    expect(manifest.icons[1]?.src).toBe('/apple-touch-icon.png');
  });
});
