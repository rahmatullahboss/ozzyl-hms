import { describe, expect, it } from 'vitest';
import {
  ALL_TENANT_PROVIDER_SHADOW_FLAGS,
  buildAllTenantProviderShadowSql,
  buildAllTenantProviderShadowVerificationSql,
  evaluateAllTenantProviderShadowScope,
} from '../../scripts/canonical/set-production-all-tenant-provider-shadow';

describe('all-tenant Canonical provider shadow contract', () => {
  it('enables every reviewed provider in shadow mode for every active tenant while preserving Legacy authority', () => {
    const sql = buildAllTenantProviderShadowSql({
      action: 'enable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-30T05:30:00.000Z',
    });

    expect(ALL_TENANT_PROVIDER_SHADOW_FLAGS).toHaveLength(9);
    for (const flag of ALL_TENANT_PROVIDER_SHADOW_FLAGS) {
      expect(sql).toContain(`('${flag.flagKey}','${flag.domain}')`);
    }
    expect(sql).toContain("FROM tenants t");
    expect(sql).toContain("WHERE t.status = 'active'");
    expect(sql).toContain("'shadow'");
    expect(sql).toContain('is_enabled');
    expect(sql).toContain("'responseAuthority','legacy'");
    expect(sql).toContain("'readPolicy','shadow'");
    expect(sql).toContain('ON CONFLICT(tenant_id,flag_key) DO UPDATE SET');
    expect(sql).not.toContain("mode = 'canonical'");
    expect(sql).not.toContain("responseAuthority','canonical'");
  });

  it('builds an exact rollback that disables only the reviewed provider shadow flags', () => {
    const sql = buildAllTenantProviderShadowSql({
      action: 'disable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-30T05:30:00.000Z',
    });

    expect(sql).toContain("SET mode = 'disabled'");
    expect(sql).toContain('is_enabled = 0');
    expect(sql).toContain("AND mode = 'shadow'");
    expect(sql).toContain("json_extract(config_json, '$.responseAuthority') = 'legacy'");
    expect(sql).toContain("tenant_id IN (SELECT CAST(id AS TEXT) FROM tenants WHERE status = 'active')");
    for (const flag of ALL_TENANT_PROVIDER_SHADOW_FLAGS) {
      expect(sql).toContain(`'${flag.flagKey}'`);
    }
  });

  it('builds aggregate-only verification for all active tenants and all reviewed providers', () => {
    const sql = buildAllTenantProviderShadowVerificationSql();

    expect(sql).toContain('active_tenants');
    expect(sql).toContain('provider_flags');
    expect(sql).toContain('expected_tenant_count');
    expect(sql).toContain('shadow_enabled_count');
    expect(sql).toContain('missing_count');
    expect(sql).toContain('non_shadow_count');
    for (const flag of ALL_TENANT_PROVIDER_SHADOW_FLAGS) {
      expect(sql).toContain(`('${flag.flagKey}','${flag.domain}')`);
    }
  });

  it('accepts only complete all-tenant shadow evidence', () => {
    const rows = ALL_TENANT_PROVIDER_SHADOW_FLAGS.map((flag) => ({
      flag_key: flag.flagKey,
      expected_tenant_count: 4,
      shadow_enabled_count: 4,
      missing_count: 0,
      non_shadow_count: 0,
    }));

    expect(evaluateAllTenantProviderShadowScope(rows)).toEqual({
      evidenceReady: true,
      activationReady: true,
      providerCount: 9,
      activeTenantCount: 4,
      issueCount: 0,
      issues: [],
      aggregateOnly: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    });
  });

  it('rejects missing or non-shadow provider rows and inconsistent tenant counts', () => {
    const rows = ALL_TENANT_PROVIDER_SHADOW_FLAGS.map((flag, index) => ({
      flag_key: flag.flagKey,
      expected_tenant_count: index === 8 ? 3 : 4,
      shadow_enabled_count: index === 0 ? 3 : 4,
      missing_count: index === 0 ? 1 : 0,
      non_shadow_count: index === 1 ? 1 : 0,
    }));

    const result = evaluateAllTenantProviderShadowScope(rows);
    expect(result.activationReady).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'PROVIDER_SHADOW_INCOMPLETE:canonical_invoice_provider_v1',
      'PROVIDER_SHADOW_NON_SHADOW:canonical_payment_provider_v1',
      'PROVIDER_SHADOW_ACTIVE_TENANT_COUNT_MISMATCH:canonical_compensation_accrual_provider_v1',
    ]));
  });

  it('rejects non-UTC timestamps', () => {
    expect(() => buildAllTenantProviderShadowSql({
      action: 'enable',
      operator: 'Rahmatullah Zisan',
      effectiveAtUtc: '2026-07-30 11:30:00',
    })).toThrow(/UTC/i);
  });
});
