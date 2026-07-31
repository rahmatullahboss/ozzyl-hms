import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('direct login hardening mount order', () => {
  it('runs the hardening boundary before the public direct-login route', () => {
    const source = readFileSync('src/index.ts', 'utf8');
    const hardener = source.indexOf("app.use('/api/auth/login-direct', hardenDirectLoginResponse);");
    const route = source.indexOf("app.route('/api/auth/login-direct', loginDirectRoutes);");
    const protectedApi = source.indexOf("app.use('/api/*', tenantMiddleware);");

    expect(hardener).toBeGreaterThan(-1);
    expect(route).toBeGreaterThan(hardener);
    expect(route).toBeLessThan(protectedApi);
  });
});
