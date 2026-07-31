import { describe, expect, it } from 'vitest';
import {
  buildSiteCacheKey,
  buildSiteRenderThrottleKey,
  PUBLIC_SITE_CACHE_VERSION,
  PUBLIC_SITE_RENDER_THROTTLE_SECONDS,
  shouldTriggerPublicSiteRender,
} from '../../src/routes/public/siteCacheKey';

describe('public site cache keys', () => {
  it('versions prerendered public site HTML keys so template changes bypass stale KV entries', () => {
    expect(PUBLIC_SITE_CACHE_VERSION).toMatch(/^v\d+$/);
    expect(buildSiteCacheKey('demo-hospital', '/site/demo-hospital', 'en')).toBe(
      `site:${PUBLIC_SITE_CACHE_VERSION}:demo-hospital:/site/demo-hospital`,
    );
    expect(buildSiteCacheKey('demo-hospital', '/site/demo-hospital/contact', 'bn')).toBe(
      `site:${PUBLIC_SITE_CACHE_VERSION}:demo-hospital:/site/demo-hospital/contact:bn`,
    );
  });

  it('throttles duplicate public-site prerenders for the same slug', async () => {
    const puts: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
    const store = new Map<string, string>();
    const kv = {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }) {
        puts.push({ key, value, options });
        store.set(key, value);
      },
    } as unknown as KVNamespace;

    await expect(shouldTriggerPublicSiteRender(kv, 'demo-hospital')).resolves.toBe(true);
    await expect(shouldTriggerPublicSiteRender(kv, 'demo-hospital')).resolves.toBe(false);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({
      key: buildSiteRenderThrottleKey('demo-hospital'),
      options: { expirationTtl: PUBLIC_SITE_RENDER_THROTTLE_SECONDS },
    });
  });
});
