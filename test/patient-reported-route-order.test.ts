import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('patient-reported route mounting', () => {
  it('mounts tenant patient-reported routes after catch-all tenant/auth middleware', () => {
    const source = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf-8');
    const tenantMiddlewareIndex = source.indexOf("app.use('/api/*', tenantMiddleware);");
    const authMiddlewareIndex = source.indexOf("return authMiddleware(c, next);", tenantMiddlewareIndex);
    const routeIndex = source.indexOf("app.route('/api/patient-reported', patientReportedRoutes);");

    expect(tenantMiddlewareIndex).toBeGreaterThan(-1);
    expect(authMiddlewareIndex).toBeGreaterThan(-1);
    expect(routeIndex).toBeGreaterThan(authMiddlewareIndex);
  });
});
