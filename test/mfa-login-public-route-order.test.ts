import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MFA login route ordering', () => {
  it('mounts only challenge verification before the protected API middleware', () => {
    const source = readFileSync('src/index.ts', 'utf8');
    const publicTenant = source.indexOf("app.use('/api/mfa/verify', tenantMiddleware);");
    const publicRateLimit = source.indexOf("app.use('/api/mfa/verify', (c, next) => rateLimitMiddleware");
    const publicVerify = source.indexOf("app.route('/api/mfa', mfaLoginVerifyRoutes);");
    const protectedApi = source.indexOf("app.use('/api/*', tenantMiddleware);");
    const protectedMfa = source.lastIndexOf("app.route('/api/mfa', mfaRoutes);");

    expect(publicTenant).toBeGreaterThan(-1);
    expect(publicRateLimit).toBeGreaterThan(publicTenant);
    expect(publicVerify).toBeGreaterThan(publicRateLimit);
    expect(publicVerify).toBeLessThan(protectedApi);
    expect(protectedMfa).toBeGreaterThan(protectedApi);
  });
});
