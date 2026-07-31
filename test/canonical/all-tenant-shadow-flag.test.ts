import { describe, expect, it } from 'vitest';
import {
  buildAllTenantFinancialShadowSql,
  buildTenant100StrictToShadowSql,
  executeTenant100StrictToShadow,
  FINANCIAL_SHADOW_FLAG_KEY,
  TENANT_100_FINANCIAL_SHADOW_APPROVAL,
  TENANT_100_FINANCIAL_SHADOW_CONFIG,
  TENANT_100_FINANCIAL_STRICT_CONFIG,
  type Tenant100FinancialShadowGateway,
} from '../../scripts/canonical/set-production-all-tenant-financial-shadow';

describe('all-tenant financial shadow flag SQL', () => {
  it('enables exact non-blocking shadow config for every active tenant', () => {
    const sql = buildAllTenantFinancialShadowSql({
      action: 'enable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-19T14:30:00.000Z',
    });

    expect(sql).toContain(`'${FINANCIAL_SHADOW_FLAG_KEY}'`);
    expect(sql).toContain("FROM tenants t");
    expect(sql).toContain("WHERE t.status = 'active'");
    expect(sql).toContain("'shadow',1");
    expect(sql).toContain("json_object('tenantScope', json_array(CAST(t.id AS TEXT)), 'writePolicy', 'shadow')");
    expect(sql).toContain('ON CONFLICT(tenant_id,flag_key) DO UPDATE SET');
    expect(sql).toContain('version = canonical_feature_flags.version + 1');
    expect(sql).not.toContain('canonical-only');
    expect(sql).not.toContain("writePolicy', 'strict'");
  });

  it('disables only the exact all-tenant shadow policy and leaves other modes untouched', () => {
    const sql = buildAllTenantFinancialShadowSql({
      action: 'disable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-19T14:30:00.000Z',
    });

    expect(sql).toContain("SET mode = 'disabled'");
    expect(sql).toContain('is_enabled = 0');
    expect(sql).toContain("AND mode = 'shadow'");
    expect(sql).toContain("json_extract(config_json, '$.writePolicy') = 'shadow'");
    expect(sql).toContain("tenant_id IN (SELECT CAST(id AS TEXT) FROM tenants WHERE status = 'active')");
    expect(sql).not.toContain("writePolicy') = 'strict'");
  });

  it('builds an exact tenant-100 strict-to-shadow transition with version precondition', () => {
    const sql = buildTenant100StrictToShadowSql({
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-20T08:00:00.000Z',
      expectedVersion: 5,
    });

    expect(sql).toContain("WHERE tenant_id = '100'");
    expect(sql).toContain(`config_json = '${TENANT_100_FINANCIAL_STRICT_CONFIG}'`);
    expect(sql).toContain(`config_json = '${TENANT_100_FINANCIAL_SHADOW_CONFIG}'`);
    expect(sql).toContain('version = version + 1');
    expect(sql).toContain('AND version = 5');
    expect(sql).toContain("AND mode = 'shadow'");
    expect(sql).toContain('AND is_enabled = 1');
  });

  it('executes and verifies the exact tenant-100 strict-to-shadow transition', async () => {
    let row: Record<string, unknown> = {
      tenant_id: '100',
      flag_key: FINANCIAL_SHADOW_FLAG_KEY,
      domain: 'financial',
      mode: 'shadow',
      is_enabled: 1,
      version: 5,
      config_json: TENANT_100_FINANCIAL_STRICT_CONFIG,
    };
    const writes: string[] = [];
    const gateway: Tenant100FinancialShadowGateway = {
      async readFlag() {
        return [row];
      },
      async writeFlag(sql) {
        writes.push(sql);
        row = { ...row, version: 6, config_json: TENANT_100_FINANCIAL_SHADOW_CONFIG };
        return { changes: 1, rowsWritten: 1 };
      },
    };

    const result = await executeTenant100StrictToShadow({
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-20T08:00:00.000Z',
      expectedVersion: 5,
      approval: TENANT_100_FINANCIAL_SHADOW_APPROVAL,
      execute: true,
    }, gateway);

    expect(result).toEqual({
      transitioned: true,
      previousVersion: 5,
      currentVersion: 6,
      writePolicy: 'shadow',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('AND version = 5');
  });

  it('refuses the transition when approval or exact strict state is missing', async () => {
    const gateway: Tenant100FinancialShadowGateway = {
      async readFlag() {
        return [{
          tenant_id: '100',
          flag_key: FINANCIAL_SHADOW_FLAG_KEY,
          domain: 'financial',
          mode: 'shadow',
          is_enabled: 1,
          version: 5,
          config_json: TENANT_100_FINANCIAL_SHADOW_CONFIG,
        }];
      },
      async writeFlag() {
        throw new Error('must not write');
      },
    };

    await expect(executeTenant100StrictToShadow({
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-20T08:00:00.000Z',
      expectedVersion: 5,
      approval: 'wrong',
      execute: true,
    }, gateway)).rejects.toThrow(/approval/i);

    await expect(executeTenant100StrictToShadow({
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-20T08:00:00.000Z',
      expectedVersion: 5,
      approval: TENANT_100_FINANCIAL_SHADOW_APPROVAL,
      execute: true,
    }, gateway)).rejects.toThrow(/exact active strict/i);
  });

  it('rejects non-UTC effective timestamps', () => {
    expect(() => buildAllTenantFinancialShadowSql({
      action: 'enable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-19 20:30:00',
    })).toThrow(/UTC/i);
    expect(() => buildTenant100StrictToShadowSql({
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-20 14:00:00',
      expectedVersion: 5,
    })).toThrow(/UTC/i);
  });
});
