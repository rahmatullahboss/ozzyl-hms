/**
 * Public API paths allowlist (P0-35).
 *
 * The service worker's runtime cache MUST NOT store responses for any
 * authenticated endpoint or any auth/registration endpoint that can return
 * tokens, session data, or patient/staff PII. Only static, unauthenticated,
 * non-sensitive public endpoints are allowed below. Everything else (`/api/*`
 * outside this list) is sent straight to the network and never written to
 * CacheStorage.
 *
 * The same public allowlist is mirrored inline in `web/vite.config.ts` Workbox
 * `runtimeCaching` because Workbox serializes that callback into sw.js. This
 * module is consumed by `web/src/main.tsx` for defensive cleanup of old
 * non-public cached responses.
 */
export const PUBLIC_API_PATHS: readonly string[] = [
  '/api/public/hospitals',
  '/api/public/site',
  '/api/public/health-check',
  '/api/push/vapid-key',
];

export const PUBLIC_API_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/public\/.+/,
  /^\/api\/push\/vapid-key\/?$/,
];

/**
 * Returns true when a request URL is allowed to be cached by the service
 * worker. Used by `web/src/main.tsx` to defensively drop any cached
 * responses for non-public paths that may exist from a previous install.
 */
export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATH_PATTERNS.some((re) => re.test(pathname));
}
