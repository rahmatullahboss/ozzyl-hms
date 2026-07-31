/**
 * useAuth — reactive auth hook using useSyncExternalStore.
 * Reads JWT from localStorage, parses claims, checks expiry.
 * Re-renders components when token changes (login/logout).
 */
import { useSyncExternalStore } from 'react';
import { normalizeRole } from '@shared/authz';

interface JWTPayload {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
  exp?: number;
  iat?: number;
}

export interface AuthUser {
  userId: string;
  role: string;
  tenantId?: string;
  permissions: string[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
}

const TOKEN_KEY = 'hms_token';
const LAST_SLUG_KEY = 'hms_last_slug';

// ─── External store for token ─────────────────────────────────────────
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// ─── Token helpers ────────────────────────────────────────────────────
function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return atob(padded);
}

function parseToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1])) as JWTPayload;
  } catch {
    return null;
  }
}

function isExpired(payload: JWTPayload): boolean {
  if (!payload.exp) return false;
  return Date.now() / 1000 > payload.exp;
}

// ─── Public API ───────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const token = useSyncExternalStore(subscribe, getSnapshot);

  if (!token) {
    return { isAuthenticated: false, user: null, token: null };
  }

  const payload = parseToken(token);

  if (!payload || isExpired(payload)) {
    // Token is invalid/expired — clean up without emitting (avoids loop)
    localStorage.removeItem(TOKEN_KEY);
    return { isAuthenticated: false, user: null, token: null };
  }

  return {
    isAuthenticated: true,
    user: {
      userId: payload.userId,
      role: normalizeRole(payload.role) || payload.role,
      tenantId: payload.tenantId,
      permissions: payload.permissions,
    },
    token,
  };
}

/** Save token and notify all useAuth consumers to re-render */
export function saveToken(token: string, slug?: string | null) {
  localStorage.setItem(TOKEN_KEY, token);
  if (slug) {
    localStorage.setItem(LAST_SLUG_KEY, slug);
  } else {
    localStorage.removeItem(LAST_SLUG_KEY);
  }
  emitChange();
}

/** Remove token and notify all useAuth consumers to re-render */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LAST_SLUG_KEY);
  emitChange();
}

/** Get raw token (for API calls in non-React code) */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getLastTenantSlug(): string | null {
  return localStorage.getItem(LAST_SLUG_KEY);
}
