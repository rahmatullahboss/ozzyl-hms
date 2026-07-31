import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('patient portal route mounting', () => {
  it('mounts patient portal routes before catch-all tenant/auth middleware', () => {
    const source = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf-8');
    const routeIndex = source.indexOf("app.route('/api/patient-portal', patientPortalRoutes);");
    const tenantMiddlewareIndex = source.indexOf("app.use('/api/*', tenantMiddleware);");
    const authMiddlewareIndex = source.indexOf("return authMiddleware(c, next);", tenantMiddlewareIndex);

    expect(routeIndex).toBeGreaterThan(-1);
    expect(tenantMiddlewareIndex).toBeGreaterThan(-1);
    expect(authMiddlewareIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeLessThan(tenantMiddlewareIndex);
    expect(routeIndex).toBeLessThan(authMiddlewareIndex);
  });
});
