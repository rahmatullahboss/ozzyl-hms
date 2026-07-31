/**
 * Regression guard for the "reload logs out staff/super-admin user" fix.
 *
 * This is a source-text check (no runtime dependency on the worker
 * runtime) so it runs in the unit-test stage and is fast enough to be
 * part of the standard pre-merge pipeline.
 *
 * If any of these assertions fail, the production reload-UX is almost
 * certainly broken again — fix the source, not the test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('staff auth reload session regression', () => {
  it('keeps staff JWT out of browser storage and uses HttpOnly cookie refresh', () => {
    const tokenStore = read('web/src/lib/tokenStore.ts');
    expect(tokenStore).not.toContain('localStorage.setItem');
    expect(tokenStore).not.toContain('sessionStorage.setItem');

    const apiClient = read('web/src/lib/apiClient.ts');
    expect(apiClient).toContain("credentials: 'include'");

    const authRoutes = read('src/routes/tenant/auth.ts');
    expect(authRoutes).toContain("tenantAuthRoutes.post('/refresh'");
    expect(authRoutes).toContain('getStaffSessionCookie');
    expect(authRoutes).toContain('setStaffSessionCookie');
    expect(authRoutes).toContain('clearStaffSessionCookie');
    expect(authRoutes).toContain('issueStaffAccessToken');

    const loginDirect = read('src/routes/login-direct.ts');
    expect(loginDirect).toContain('setStaffSessionCookie');

    const cookieHelper = read('src/lib/staff-session-cookie.ts');
    expect(cookieHelper).toContain('httpOnly: true');
    expect(cookieHelper).toContain("sameSite: 'Lax'");
    expect(cookieHelper).toContain("path: '/api/auth'");

    const app = read('web/src/App.tsx');
    expect(app).toContain('StaffSessionBootstrap');
    expect(app).toContain('/api/auth/refresh');
    expect(app).toContain('saveToken');
  });
});

describe('super admin reload session regression', () => {
  it('keeps super admin JWT in HttpOnly cookie and recovers session via /api/admin/refresh', () => {
    const middlewareAuth = read('src/middleware/auth.ts');
    expect(middlewareAuth).toContain("'/api/admin/refresh'");

    const adminRoutes = read('src/routes/admin/index.ts');
    expect(adminRoutes).toContain("adminRoutes.post('/refresh'");
    expect(adminRoutes).toContain("getCookie(c, 'admin_token')");
    // Login still never returns a token in the body — only a user.
    expect(adminRoutes).toMatch(/return c\.json\(\s*\{\s*user:/);
    // Logout clears the cookie + blacklists the bearer.
    expect(adminRoutes).toContain("setCookie(c, 'admin_token', ''");
    expect(adminRoutes).toContain('blacklistToken');

    const adminSessionStore = read('web/src/lib/adminSessionStore.ts');
    // No token in the indicator — the JWT lives in the cookie.
    expect(adminSessionStore).not.toContain('localStorage');
    expect(adminSessionStore).not.toContain('sessionStorage');

    const app = read('web/src/App.tsx');
    expect(app).toContain('AdminSessionBootstrap');
    expect(app).toContain('/api/admin/refresh');
    expect(app).toContain('setAdminSession');
    expect(app).toContain('clearAdminSession');

    const adminLogin = read('web/src/pages/AdminLogin.tsx');
    // AdminLogin must NOT read a token from the response body anymore.
    expect(adminLogin).not.toContain('setAccessToken(res.token)');
    expect(adminLogin).not.toContain('res.token &&');
    expect(adminLogin).toContain('setAdminSession');
  });
});

