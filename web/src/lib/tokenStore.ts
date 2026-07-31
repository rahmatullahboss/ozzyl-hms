/**
 * tokenStore — in-memory auth token store (replaces localStorage-based JWT).
 *
 * SECURITY (P0-34): The staff JWT MUST NOT be persisted to localStorage /
 * sessionStorage. localStorage is readable by any script on the same origin
 * (including any XSS payload), so a stored token is effectively a long-lived
 * credential. The frontend now keeps the access token in a module-level
 * variable that is wiped on page reload.
 *
 * TODO: backend HttpOnly cookie
 *   The browser-side hardening is only half the fix. The backend should also
 *   set the refresh token as an HttpOnly + Secure + SameSite cookie so the
 *   client never sees a long-lived credential. Until the backend implements
 *   that, the access token still has to live in memory and will be lost on
 *   reload — callers that require a session across reloads should re-auth
 *   via the login flow. See `docs/CODE_REVIEW_PHASED_REPORT.md` P0-34.
 *
 * API consumers (apiClient, hooks, sync-engine) MUST import `getAccessToken`
 * / `setAccessToken` / `clearAccessToken` from this module rather than
 * reading localStorage directly.
 */

export interface AccessTokenClaims {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
  isImpersonation?: boolean;
  exp?: number;
  iat?: number;
}

let _token: string | null = null;
let _claims: AccessTokenClaims | null = null;

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return atob(normalized + '='.repeat(padLength));
}

/** Parse a JWT (no signature verification — server-side job) */
export function parseAccessToken(token: string): AccessTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1])) as AccessTokenClaims;
  } catch {
    return null;
  }
}

function isExpired(claims: AccessTokenClaims): boolean {
  if (!claims.exp) return false;
  return Date.now() / 1000 > claims.exp;
}

/** Get the current access token (or null when not logged in / expired). */
export function getAccessToken(): string | null {
  if (!_token) return null;
  if (_claims && isExpired(_claims)) {
    // Self-heal: don't return a known-expired token.
    _token = null;
    _claims = null;
    return null;
  }
  return _token;
}

/** Get parsed claims from the current access token. */
export function getAccessTokenClaims(): AccessTokenClaims | null {
  if (!_token || !_claims) return null;
  if (isExpired(_claims)) {
    _token = null;
    _claims = null;
    return null;
  }
  return _claims;
}

/** Set (or replace) the current access token. */
export function setAccessToken(token: string): void {
  const claims = parseAccessToken(token);
  if (!claims) {
    // Refuse to store an unparseable token.
    clearAccessToken();
    return;
  }
  _token = token;
  _claims = claims;
}

/** Clear the in-memory token. */
export function clearAccessToken(): void {
  _token = null;
  _claims = null;
}

/** Returns true when a non-expired token is present. */
export function isAuthenticated(): boolean {
  return getAccessToken() !== null;
}
