import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('i18next-http-backend', () => ({
  default: {
    type: 'backend',
    init: vi.fn(),
    read: (_language: string, _namespace: string, callback: (error: Error | null, data: false | Record<string, unknown>) => void) => {
      callback(new Error('locale endpoint unavailable'), false);
    },
  },
}));

vi.mock('i18next-browser-languagedetector', () => ({
  default: {
    type: 'languageDetector',
    init: vi.fn(),
    detect: () => 'en',
    cacheUserLanguage: vi.fn(),
  },
}));

async function waitForInitialization(i18n: typeof import('./i18n').default) {
  if (i18n.isInitialized) return;
  await new Promise<void>((resolve) => {
    i18n.on('initialized', () => resolve());
  });
}

describe('tenantLab translation resilience', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps LIS dashboard labels translated when the runtime locale endpoint is unavailable', async () => {
    const { default: i18n } = await import('./i18n');
    await waitForInitialization(i18n);

    expect(i18n.hasResourceBundle('en', 'tenantLab')).toBe(true);
    expect(i18n.t('laboratoryDashboard.hero.title', { ns: 'tenantLab' })).toBe('Operational LIS Control Room');
    expect(i18n.t('laboratoryDashboard.card.todayOrders', { ns: 'tenantLab' })).toBe('Today Orders');
    expect(i18n.t('laboratoryDashboard.tab.overview', { ns: 'tenantLab' })).toBe('Overview');
  });
});
