/**
 * useAuth — reactive auth hook using useSyncExternalStore.
 *
 * SECURITY (P0-34): The access token NO LONGER lives in localStorage.
 * It is held in a module-level variable via `lib/tokenStore.ts` so it
 * is wiped on page reload. The hook re-renders components on token
 * change by subscribing to a custom event that `setAccessToken` /
 * `clearAccessToken` emit.
 *
 * TODO: backend HttpOnly cookie
 *   The browser-side hardening is only half the fix. The backend should
 *   set the refresh token as an HttpOnly + Secure + SameSite cookie.
 *   Until then, the in-memory access token will be lost on reload —
 *   see `docs/CODE_REVIEW_PHASED_REPORT.md` P0-34.
 */
import { useSyncExternalStore } from 'react';
import { normalizeRole } from '@shared/authz';

import {
  clearAccessToken as storeClearAccessToken,
  getAccessToken as storeGetAccessToken,
  getAccessTokenClaims,
  setAccessToken as storeSetAccessToken,
} from '../lib/tokenStore';

export interface AuthUser {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
  isImpersonation?: boolean;
  supportActorUserId?: string;
  supportReason?: string;
  supportSessionId?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
}

export interface TenantSession {
  id?: number | string;
  name?: string;
  slug?: string;
}

// ─── External store for token ─────────────────────────────────────────
//
// We piggy-back on a synthetic version counter so React's
// useSyncExternalStore sees a new snapshot every time the token
// changes. The token itself is read from the in-memory store, NOT
// from localStorage (P0-34).
let _version = 0;
const _listeners: Set<() => void> = new Set();

function _bump(): void {
  _version++;
  for (const listener of _listeners) {
    try {
      listener();
    } catch {
      // listener errors must not break the auth state machine
    }
  }
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _getSnapshot(): number {
  return _version;
}

function _getServerSnapshot(): number {
  return 0;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * React hook: returns the current auth state and re-renders the calling
 * component when the access token is set/cleared.
 */
export function useAuth(): AuthState {
  // useSyncExternalStore needs a version-shaped snapshot.
  useSyncExternalStore(_subscribe, _getSnapshot, _getServerSnapshot);

  const token = storeGetAccessToken();
  if (!token) {
    return { isAuthenticated: false, user: null, token: null };
  }

  const claims = getAccessTokenClaims();
  if (!claims) {
    storeClearAccessToken();
    return { isAuthenticated: false, user: null, token: null };
  }

  return {
    isAuthenticated: true,
    user: {
      userId: claims.userId,
      role: normalizeRole(claims.role) || claims.role,
      tenantId: claims.tenantId,
      permissions: claims.permissions,
      isImpersonation: claims.isImpersonation,
      supportActorUserId: (claims as { impersonatedByUserId?: string }).impersonatedByUserId,
      supportReason: (claims as { impersonationReason?: string }).impersonationReason,
      supportSessionId: (claims as { impersonationSessionId?: string }).impersonationSessionId,
    },
    token,
  };
}

/** Save the access token (in memory only) and notify auth subscribers. */
export function saveToken(token: string, _slug?: string | null, _tenant?: TenantSession | null): void {
  storeSetAccessToken(token);
  // Slug/tenant metadata is derived at request time from URL/host. No
  // localStorage write happens here (P0-34).
  _bump();
}

/** Clear the access token (in memory only) and notify auth subscribers. */
export function logout(): void {
  storeClearAccessToken();
  _bump();
}

/** Get the raw access token (for non-React code). */
export function getToken(): string | null {
  return storeGetAccessToken();
}

// Legacy compatibility shims. These used to read/write localStorage.
// They are kept as no-ops so older imports do not throw, but they
// intentionally do NOT persist anything to disk.

/** @deprecated Slug is now read from the URL. Returns null. */
export function getLastTenantSlug(): string | null {
  return null;
}

/** @deprecated Tenant session is derived from the URL. Returns null. */
export function getTenant(): TenantSession | null {
  return null;
}
