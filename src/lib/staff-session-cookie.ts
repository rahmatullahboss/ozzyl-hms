/**
 * staff-session-cookie — HttpOnly refresh-cookie helper for the staff
 * login flow (P0-34 follow-up).
 *
 * SECURITY MODEL
 * ──────────────
 * The access JWT lives ONLY in JavaScript memory (see `lib/tokenStore.ts`).
 * On a hard reload, the SPA's memory is empty, so the access token is
 * gone — and ProtectedRoute would otherwise bounce the user back to
 * /login.
 *
 * To survive reloads without weakening P0-34, the backend sets a long
 * lived HttpOnly cookie (`hms_staff_session`) that holds a JWT-shaped
 * session token. The SPA calls `POST /api/auth/refresh` on mount; the
 * backend verifies the HttpOnly cookie, mints a fresh in-memory access
 * token, and the SPA restores its in-memory copy. The cookie is never
 * readable from JavaScript, so an XSS payload cannot exfiltrate it.
 *
 * path: /api/auth — scope the cookie to the auth endpoints so it is NOT
 * sent on every other API call. This minimises its blast radius while
 * still allowing the browser to send it on the two endpoints that need
 * it (`/api/auth/refresh` and `/api/auth/logout`).
 */

import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export const STAFF_SESSION_COOKIE = 'hms_staff_session';
export const STAFF_SESSION_TTL_SECONDS = 8 * 3600;

function isSecureCookie(c: Parameters<typeof setCookie>[0]): boolean {
  return (c.env as { ENVIRONMENT?: string }).ENVIRONMENT !== 'development';
}

export function setStaffSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, STAFF_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(c),
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: STAFF_SESSION_TTL_SECONDS,
  });
}

export function getStaffSessionCookie(c: Parameters<typeof getCookie>[0]): string | null {
  return getCookie(c, STAFF_SESSION_COOKIE) ?? null;
}

export function clearStaffSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, STAFF_SESSION_COOKIE, {
    path: '/api/auth',
  });
}
