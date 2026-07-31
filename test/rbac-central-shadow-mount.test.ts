import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('central RBAC middleware route order', () => {
  it('mounts central route permission enforcement after auth and before audit', () => {
    const source = readFileSync('src/index.ts', 'utf8');

    const tenantMiddlewareIndex = source.indexOf("app.use('/api/*', tenantMiddleware);");
    const authIndex = source.indexOf("return authMiddleware(c, next);", tenantMiddlewareIndex);
    const permissionIndex = source.indexOf("app.use('/api/*', centralRoutePermissionFromEnv());");
    const auditIndex = source.indexOf("app.use('/api/*', autoAuditMiddleware());");

    expect(source).toContain("centralRoutePermissionFromEnv");
    expect(authIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(permissionIndex).toBeLessThan(auditIndex);
  });
});
