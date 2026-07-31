export const PUBLIC_SITE_CACHE_VERSION = 'v2';
export const PUBLIC_SITE_RENDER_THROTTLE_SECONDS = 300;

const localRenderThrottleUntil = new Map<string, number>();

export function buildSiteCacheKey(slug: string, pagePath: string, lang: 'en' | 'bn'): string {
  const langSuffix = lang === 'bn' ? ':bn' : '';
  return `site:${PUBLIC_SITE_CACHE_VERSION}:${slug}:${pagePath}${langSuffix}`;
}

export function buildSiteRenderThrottleKey(slug: string): string {
  return `site-render:${PUBLIC_SITE_CACHE_VERSION}:${slug}`;
}

export async function shouldTriggerPublicSiteRender(
  kv: KVNamespace,
  slug: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const key = buildSiteRenderThrottleKey(slug);
  const localUntil = localRenderThrottleUntil.get(key);

  if (localUntil && localUntil > nowMs) {
    return false;
  }

  if (localUntil && localUntil <= nowMs) {
    localRenderThrottleUntil.delete(key);
  }

  let existingLock: string | null = null;
  try {
    existingLock = await kv.get(key);
  } catch {
    localRenderThrottleUntil.set(key, nowMs + PUBLIC_SITE_RENDER_THROTTLE_SECONDS * 1000);
    return true;
  }

  if (existingLock) {
    localRenderThrottleUntil.set(key, nowMs + PUBLIC_SITE_RENDER_THROTTLE_SECONDS * 1000);
    return false;
  }

  localRenderThrottleUntil.set(key, nowMs + PUBLIC_SITE_RENDER_THROTTLE_SECONDS * 1000);
  try {
    await kv.put(key, String(nowMs), { expirationTtl: PUBLIC_SITE_RENDER_THROTTLE_SECONDS });
  } catch {
    // The throttle is best-effort only. Rendering should still be attempted.
  }
  return true;
}
