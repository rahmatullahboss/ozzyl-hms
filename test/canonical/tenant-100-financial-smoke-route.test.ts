import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('tenant-100 protected financial smoke route contract', () => {
  it('requires an exact secret, hospital-admin role, tenant 100, and a fixed candidate version tag', () => {
    const route = source('src/routes/tenant/canonicalFinancialSmoke.ts');

    expect(route).toContain("requireRole('hospital_admin')");
    expect(route).toContain("c.req.header('x-cdb101-financial-smoke-guard')");
    expect(route).toContain('c.env.CDB101_FINANCIAL_SMOKE_GUARD');
    expect(route).toContain("FINANCIAL_SMOKE_CANDIDATE_TAG = 'cdb101-financial-smoke-fix-20260719-c1'");
    expect(route).toContain("tenantId !== '100'");
    expect(route).toContain('c.env.CF_VERSION_METADATA?.id');
    expect(route).toContain('c.env.CF_VERSION_METADATA?.tag');
    expect(route).toContain('actualWorkerVersionTag !== FINANCIAL_SMOKE_CANDIDATE_TAG');
    expect(route).toContain('expectedWorkerVersionTag: FINANCIAL_SMOKE_CANDIDATE_TAG');
    expect(route).toContain('workerVersionId: actualWorkerVersionId');
    expect(route).toContain('workerVersionTag: actualWorkerVersionTag');
    expect(route).toContain('executeTenant100FinancialSmokeFixture');
    expect(route).toContain('amountMinor: 100');
  });

  it('requires the exact pre-activation disabled flag row instead of accepting a missing flag', () => {
    const route = source('src/routes/tenant/canonicalFinancialSmoke.ts');

    expect(route).toContain('flag_key,domain,mode,is_enabled,version,config_json');
    expect(route).toContain('if (!flag)');
    expect(route).toContain("flag.domain !== 'financial'");
    expect(route).toContain("flag.mode !== 'disabled'");
    expect(route).toContain('flag.is_enabled !== 0');
    expect(route).toContain('flag.version !== FINANCIAL_DISABLED_VERSION');
    expect(route).toContain('flag.config_json !== FINANCIAL_DISABLED_CONFIG');
    expect(route).toContain("writePolicy\":\"canonical-only");
  });

  it('declares the protected secret binding and mounts only the dedicated API surface', () => {
    const types = source('src/types.ts');
    const index = source('src/index.ts');
    const permissions = source('src/lib/route-permissions.ts');

    expect(types).toContain('CDB101_FINANCIAL_SMOKE_GUARD?: string');
    expect(types).not.toContain('CDB101_FINANCIAL_SMOKE_WORKER_VERSION_ID');
    expect(index).toContain("import canonicalFinancialSmokeRoutes from './routes/tenant/canonicalFinancialSmoke'");
    expect(index).toContain("app.route('/api/canonical-financial-smoke', canonicalFinancialSmokeRoutes)");
    expect(permissions).toContain("prefix: '/api/canonical-financial-smoke'");
    expect(permissions).toContain("rolesAllowed: ['hospital_admin']");
  });
});
