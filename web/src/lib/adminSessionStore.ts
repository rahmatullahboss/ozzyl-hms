/**
 * adminSessionStore — in-memory super-admin session indicator.
 *
 * SECURITY MODEL (P0-34 follow-up, super_admin branch)
 * ────────────────────────────────────────────────────
 * The super-admin JWT lives ONLY in the HttpOnly `admin_token` cookie
 * (see `src/routes/admin/index.ts`). The browser never exposes it to
 * JavaScript, and we do NOT want to mint a second in-memory copy — the
 * cookie is the source of truth.
 *
 * The frontend still needs to know whether the user is currently
 * authenticated, what their role is, and how to render the layout. So
 * we keep a *minimal* session indicator (user id, role, display name)
 * that is set on a successful login or `/api/admin/refresh` response
 * and cleared on logout. No JWT, no permissions, no claims — those
 * are server-side only.
 *
 * `isAdminAuthenticated()` returns true iff the indicator is present
 * AND we have not been cleared by a logout. The SPA's ProtectedRoute
 * can then allow `/super-admin/*` traffic; the actual API calls are
 * authenticated by the HttpOnly cookie on every request.
 *
 * Reload behaviour: memory is wiped, so on first paint the indicator
 * is null. `AdminSessionBootstrap` then calls `/api/admin/refresh`,
 * which reads the cookie server-side, and the indicator is set iff
 * the cookie is still valid. The cookie's maxAge is 8h, matching the
 * JWT exp.
 */

export type AdminSessionRole =
  | 'super_admin'
  | 'platform_admin'
  | 'platform_setup'
  | 'platform_support'
  | 'platform_auditor';

const ADMIN_SESSION_ROLES = new Set<AdminSessionRole>([
  'super_admin',
  'platform_admin',
  'platform_setup',
  'platform_support',
  'platform_auditor',
]);

export interface AdminSession {
  userId: string;
  role: AdminSessionRole;
  name: string;
  email: string;
}

let _session: AdminSession | null = null;
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

export function getAdminSession(): AdminSession | null {
  return _session;
}

export function isAdminAuthenticated(): boolean {
  return _session !== null;
}

export function setAdminSession(session: AdminSession): void {
  if (!ADMIN_SESSION_ROLES.has(session.role)) {
    return;
  }
  _session = session;
  _bump();
}

export function clearAdminSession(): void {
  if (_session === null) return;
  _session = null;
  _bump();
}

/**
 * React-style version getter. Currently unused by the React tree, but
 * kept here so future components can subscribe to session changes via
 * `useSyncExternalStore` without a second singleton.
 */
export function subscribeAdminSession(listener: () => void): () => void {
  return _subscribe(listener);
}

export function getAdminSessionVersion(): number {
  return _version;
}

// Re-export the snapshot helpers so a future React hook can live in
// this module without re-implementing them.
export const _adminSessionStoreInternals = {
  subscribe: _subscribe,
  getSnapshot: _getSnapshot,
  getServerSnapshot: _getServerSnapshot,
};
